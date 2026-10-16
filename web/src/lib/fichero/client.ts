import { SERVICE_PROFILES, NAME_PREFIXES, CHUNK_SIZE, CHUNK_DELAY_MS, CMD } from "./constants";
import { TypedEventEmitter } from "./emitter";
import { Utils } from "./utils";
import { FicheroPrintTask } from "./print_task";
import type {
  ConnectionInfo,
  HeartbeatData,
  PrinterInfo,
  PrinterModelMeta,
  PrintProgressEvent,
  FirmwareProgressEvent,
  RfidInfo,
  Packet,
  LabelType,
  PrintTaskName,
} from "./types";

interface ClientEventMap {
  connect: { info: ConnectionInfo };
  disconnect: void;
  printerinfofetched: { info: PrinterInfo };
  heartbeat: { data: HeartbeatData };
  heartbeatfailed: { failedAttempts: number };
  printprogress: PrintProgressEvent;
  firmwareprogress: FirmwareProgressEvent;
  packetsent: { packet: Packet };
  packetreceived: { packet: Packet };
}

function makePacket(data: readonly number[] | number[] | Uint8Array): Packet {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const cmd = bytes.length >= 2 ? (bytes[0] << 8) | bytes[1] : bytes[0] ?? 0;
  return {
    command: cmd,
    toBytes: () => bytes,
  };
}

export class FicheroClient extends TypedEventEmitter<ClientEventMap> {
  private device: BluetoothDevice | null = null;
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyChar: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyListener: ((e: Event) => void) | null = null;
  private notifyBuf: number[] = [];
  private notifyResolve: (() => void) | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private heartbeatFailCount = 0;
  private packetIntervalMs = 20;
  private info: PrinterInfo = {};

  readonly abstraction = {
    newPrintTask: (
      _name: PrintTaskName,
      opts: {
        totalPages: number;
        density: number;
        speed: number;
        labelType: LabelType;
        statusPollIntervalMs: number;
        statusTimeoutMs: number;
      },
    ) => {
      return new FicheroPrintTask(
        opts,
        (data, wait, timeout) => this.sendCommand(data, wait, timeout),
        (data) => this.sendChunked(data),
        (e) => this.emit("printprogress", e),
      );
    },

    printEnd: async () => {
      // No-op for D11s - stop is handled per-copy in print task
    },

    printerReset: async () => {
      await this.sendCommand(CMD.factoryReset, true);
    },

    rfidInfo: async (): Promise<RfidInfo> => {
      return {};
    },

    rfidInfo2: async (): Promise<RfidInfo> => {
      return {};
    },

    setSoundEnabled: async (_type: number, _enabled: boolean) => {
      // Not supported on D11s
    },

    firmwareUpgrade: async (_data: Uint8Array, _version: string) => {
      throw new Error("Firmware upgrade not implemented");
    },
  };

  /**
   * Opens the browser's Bluetooth device chooser and connects to the selected printer.
   * Pass `showAll: true` to list every nearby BLE device instead of only Fichero/D11s names
   * (useful if the printer does not include its name in the advertisement).
   */
  async connect(opts?: { showAll?: boolean }): Promise<void> {
    const device = await this.pickDevice(opts?.showAll ?? false);

    this.device = device;
    device.addEventListener("gattserverdisconnected", () => {
      // Ignore stale events from a device of an earlier session.
      if (this.device === device) this.onDisconnected();
    });

    try {
      await this.openGatt(device);
    } catch (e) {
      this.releaseGatt(device);
      throw e;
    }

    this.emit("connect", { info: { deviceName: device.name } });

    try {
      await this.fetchPrinterInfo();
    } catch (e) {
      // The link is up; a failed info query should not tear it down.
      console.warn("Could not read printer info", e);
    }
    this.startHeartbeat();
  }

  private async pickDevice(showAll: boolean): Promise<BluetoothDevice> {
    const optionalServices = SERVICE_PROFILES.map((p) => p.service);

    try {
      return await navigator.bluetooth.requestDevice(
        showAll
          ? { acceptAllDevices: true, optionalServices }
          : { filters: NAME_PREFIXES.map((namePrefix) => ({ namePrefix })), optionalServices },
      );
    } catch (e) {
      const err = e as { name?: string; message?: string };
      if (err?.name === "NotFoundError") {
        // Chrome reports both "user closed the chooser" and "no adapter / nothing found" this way.
        if (/cancel/i.test(err.message ?? "")) throw new Error("No device selected");
        throw new Error(`No printer found: ${err.message ?? "unknown reason"}`);
      }
      throw new Error(`Bluetooth error (${err?.name ?? "unknown"}): ${err?.message ?? String(e)}`);
    }
  }

  private async openGatt(device: BluetoothDevice): Promise<void> {
    const gatt = device.gatt;
    if (!gatt) throw new Error("This device does not expose a GATT server");

    // The first GATT connection attempt often fails on Android / when the printer was just powered on.
    let server: BluetoothRemoteGATTServer | undefined;
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3 && !server; attempt++) {
      try {
        server = await gatt.connect();
      } catch (e) {
        lastError = e;
        try {
          gatt.disconnect();
        } catch {
          /* ignore */
        }
        await Utils.sleep(400 * attempt);
      }
    }
    if (!server) {
      throw new Error(
        `Could not connect to ${device.name ?? "the printer"} (${FicheroClient.errText(lastError)}). ` +
          "Make sure it is on, close by, and not connected to another app or phone.",
      );
    }

    // Give the stack a moment before service discovery; doing it immediately can fail.
    await Utils.sleep(300);

    let found: { write: BluetoothRemoteGATTCharacteristic; notify: BluetoothRemoteGATTCharacteristic } | undefined;
    for (let attempt = 1; attempt <= 2 && !found; attempt++) {
      for (const profile of SERVICE_PROFILES) {
        try {
          const service = await server.getPrimaryService(profile.service);
          const write = await service.getCharacteristic(profile.write);
          const notify = await service.getCharacteristic(profile.notify);
          found = { write, notify };
          break;
        } catch (e) {
          lastError = e;
        }
      }
      if (!found) await Utils.sleep(500);
    }
    if (!found) {
      throw new Error(`The printer's Bluetooth service was not found (${FicheroClient.errText(lastError)}).`);
    }

    // Register the listener before enabling notifications so the first response is not missed.
    this.notifyListener = (e: Event) => this.onNotify(e);
    found.notify.addEventListener("characteristicvaluechanged", this.notifyListener);
    await found.notify.startNotifications();

    this.writeChar = found.write;
    this.notifyChar = found.notify;
  }

  /** Cleans up after a failed connection attempt without emitting a disconnect event. */
  private releaseGatt(device: BluetoothDevice): void {
    if (this.notifyChar && this.notifyListener) {
      this.notifyChar.removeEventListener("characteristicvaluechanged", this.notifyListener);
    }
    this.notifyListener = null;
    this.writeChar = null;
    this.notifyChar = null;
    if (this.device === device) this.device = null;
    try {
      if (device.gatt?.connected) device.gatt.disconnect();
    } catch {
      /* ignore */
    }
  }

  private static errText(e: unknown): string {
    const err = e as { name?: string; message?: string } | undefined;
    return err?.message ? `${err.name ?? "Error"}: ${err.message}` : String(e ?? "unknown error");
  }

  private async writeBytes(char: BluetoothRemoteGATTCharacteristic, bytes: Uint8Array): Promise<void> {
    // writeValueWithoutResponse is missing in older Chrome versions.
    const noResponseFn = (char as { writeValueWithoutResponse?: unknown }).writeValueWithoutResponse;
    if (typeof noResponseFn === "function") {
      await char.writeValueWithoutResponse(bytes);
    } else {
      await char.writeValue(bytes);
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    const device = this.device;
    this.onDisconnected();
    try {
      if (device?.gatt?.connected) device.gatt.disconnect();
    } catch {
      /* ignore */
    }
  }

  private onDisconnected(): void {
    if (!this.device) return; // already handled
    this.stopHeartbeat();
    if (this.notifyChar && this.notifyListener) {
      this.notifyChar.removeEventListener("characteristicvaluechanged", this.notifyListener);
    }
    this.notifyListener = null;
    this.device = null;
    this.writeChar = null;
    this.notifyChar = null;
    this.info = {};
    this.emit("disconnect", undefined as unknown as void);
  }

  private onNotify(event: Event): void {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    const dv = target.value!;
    // Respect the DataView's offset/length; the underlying buffer may be larger than the payload.
    const val = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    this.notifyBuf.push(...val);
    if (this.notifyResolve) {
      this.notifyResolve();
      this.notifyResolve = null;
    }
  }

  private waitForNotify(timeout = 2000): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.notifyResolve = null;
        resolve();
      }, timeout);
      this.notifyResolve = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  async sendCommand(
    data: readonly number[] | number[] | Uint8Array,
    wait = false,
    timeout = 2000,
  ): Promise<Uint8Array> {
    if (!this.writeChar) throw new Error("Not connected");

    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

    this.emit("packetsent", { packet: makePacket(bytes) });

    if (wait) {
      this.notifyBuf = [];
    }

    await this.writeBytes(this.writeChar, bytes);

    if (wait) {
      await this.waitForNotify(timeout);
      await Utils.sleep(50);
    }

    const response = new Uint8Array(this.notifyBuf);

    if (wait && response.length > 0) {
      this.emit("packetreceived", { packet: makePacket(response) });
    }

    return response;
  }

  async sendChunked(data: Uint8Array): Promise<void> {
    if (!this.writeChar) throw new Error("Not connected");

    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.slice(i, i + CHUNK_SIZE);
      await this.writeBytes(this.writeChar, chunk);
      await Utils.sleep(CHUNK_DELAY_MS);
    }
  }

  private decodeResponse(buf: number[] | Uint8Array): string {
    return new TextDecoder().decode(new Uint8Array(buf)).trim();
  }

  async fetchPrinterInfo(): Promise<void> {
    const info: PrinterInfo = {};

    let r = await this.sendCommand(CMD.getModel, true);
    info.modelId = this.decodeResponse(r);

    r = await this.sendCommand(CMD.getFirmware, true);
    info.firmware = this.decodeResponse(r);

    r = await this.sendCommand(CMD.getSerial, true);
    info.serial = this.decodeResponse(r);

    r = await this.sendCommand(CMD.getBattery, true);
    if (r.length >= 2) {
      info.battery = r[r.length - 1];
      info.charging = r[r.length - 2] !== 0;
    }

    r = await this.sendCommand(CMD.getStatus, true);
    if (r.length > 0) {
      const sb = r[r.length - 1];
      info.status = this.parseStatusByte(sb);
    }

    this.info = info;
    this.emit("printerinfofetched", { info });
  }

  private parseStatusByte(byte: number): string {
    const flags: string[] = [];
    if (byte & 0x01) flags.push("printing");
    if (byte & 0x02) flags.push("cover open");
    if (byte & 0x04) flags.push("no paper");
    if (byte & 0x08) flags.push("low battery");
    if (byte & 0x10 || byte & 0x40) flags.push("overheated");
    if (byte & 0x20) flags.push("charging");
    return flags.length ? flags.join(", ") : "ready";
  }

  getModelMetadata(): PrinterModelMeta {
    return {
      model: this.info.modelId ?? "D11s",
      printheadPixels: 96,
      printDirection: "left" as const,
      densityMin: 0,
      densityMax: 2,
      densityDefault: 2,
      paperTypes: [1, 2, 3], // LabelType values
    };
  }

  getPrintTaskType(): PrintTaskName {
    return "B1";
  }

  setPacketInterval(ms: number): void {
    this.packetIntervalMs = ms;
  }

  startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatFailCount = 0;

    this.heartbeatTimer = setInterval(async () => {
      try {
        const r = await this.sendCommand(CMD.getBattery, true);
        if (r.length >= 2) {
          const data: HeartbeatData = {
            chargeLevel: r[r.length - 1],
            charging: r[r.length - 2] !== 0,
          };
          this.heartbeatFailCount = 0;
          this.emit("heartbeat", { data });
        }
      } catch {
        this.heartbeatFailCount++;
        this.emit("heartbeatfailed", { failedAttempts: this.heartbeatFailCount });
      }
    }, 5000);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
}

export class FicheroBluetoothClient extends FicheroClient {}

export function instantiateClient(_type?: string): FicheroClient {
  return new FicheroBluetoothClient();
}
