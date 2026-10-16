<script lang="ts">
  import { SoundSettingsItemType, Utils, type AvailableTransports } from "$/lib/fichero";
  import {
    printerClient,
    connectedPrinterName,
    connectionState,
    initClient,
    heartbeatData,
    printerInfo,
    printerMeta,
    heartbeatFails,
    rfidInfo,
    ribbonRfidInfo,
    refreshRfidInfo,
  } from "$/stores";
  import { tr } from "$/utils/i18n";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { Toasts } from "$/utils/toasts";
  import type { MaterialIcon } from "material-icons";
  import FirmwareUpdater from "$/components/basic/FirmwareUpdater.svelte";

  // Detect immediately (no SSR here) so the button never depends on a later mount hook.
  const featureSupport: AvailableTransports = Utils.getAvailableTransports();

  /** Explains why Web Bluetooth is unavailable, so the button never just "does nothing". */
  const unsupportedReason = (): string => {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      return "Web Bluetooth only works on HTTPS pages (or localhost). This page was opened over plain HTTP, so the browser hides Bluetooth. Open the https:// address instead.";
    }
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      return "iPhone/iPad browsers don't support Web Bluetooth. Use Chrome on Android or a computer.";
    }
    return "This browser doesn't support Web Bluetooth. On Android, open this page in Chrome (not an in-app browser).";
  };

  const connectTo = async (showAll: boolean) => {
    if (!featureSupport.webBluetooth) {
      Toasts.error(unsupportedReason());
      return;
    }

    initClient();
    connectionState.set("connecting");

    try {
      await $printerClient.connect({ showAll });
    } catch (e) {
      connectionState.set("disconnected");
      Toasts.error(e);
    }
  };

  const onConnectClicked = () => connectTo(false);
  // Fallback: list every nearby BLE device, for printers that don't advertise their name.
  const onConnectAnyClicked = () => connectTo(true);

  const onDisconnectClicked = () => {
    $printerClient.disconnect();
  };

  const startHeartbeat = async () => {
    $printerClient.startHeartbeat();
  };

  const stopHeartbeat = async () => {
    $printerClient.stopHeartbeat();
  };

  const soundOn = async () => {
    await $printerClient.abstraction.setSoundEnabled(SoundSettingsItemType.BluetoothConnectionSound, true);
    await $printerClient.abstraction.setSoundEnabled(SoundSettingsItemType.PowerSound, true);
  };

  const soundOff = async () => {
    await $printerClient.abstraction.setSoundEnabled(SoundSettingsItemType.BluetoothConnectionSound, false);
    await $printerClient.abstraction.setSoundEnabled(SoundSettingsItemType.PowerSound, false);
  };

  const fetchInfo = async () => {
    await $printerClient.fetchPrinterInfo();
  };

  const reset = async () => {
    await $printerClient.abstraction.printerReset();
  };

  const batteryIcon = (value: number): MaterialIcon => {
    if (value > 4) {
      value = Math.min(4, Math.max(1, Math.ceil(value / 25)));
    }

    if (value === 4) {
      return "battery_full";
    } else if (value === 3) {
      return "battery_5_bar";
    } else if (value === 2) {
      return "battery_3_bar";
    } else if (value === 1) {
      return "battery_2_bar";
    }
    return "battery_0_bar";
  };

</script>

<div class="input-group w-auto input-group-sm flex-nowrap justify-content-end">
  {#if $connectionState === "connected"}
    <button class="btn btn-secondary" data-bs-toggle="dropdown" data-bs-auto-close="outside">
      <MdIcon icon="settings" />
    </button>
    <div class="dropdown-menu p-1">
      {#if $printerInfo}
        <div>
          Printer info:
          <ul>
            {#each Object.entries($printerInfo) as [key, value] (key)}
              <li>{key}: <strong>{value ?? "-"}</strong></li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if $printerMeta}
        <button
          class="btn btn-sm btn-outline-secondary d-block w-100 mt-1"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#modelMeta">
          Model metadata <MdIcon icon="expand_more" />
        </button>

        <div class="collapse" id="modelMeta">
          <ul>
            {#each Object.entries($printerMeta) as [key, value] (key)}
              <li>{key}: <strong>{value ?? "-"}</strong></li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if $rfidInfo}
        <button
          class="btn btn-sm btn-outline-secondary d-block w-100 mt-1"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#rfidInfo">
          RFID info <MdIcon icon="expand_more" />
        </button>

        <div class="collapse" id="rfidInfo">
          <button class="btn btn-outline-secondary btn-sm mt-1" onclick={refreshRfidInfo}>Update</button>

          <ul>
            {#each Object.entries($rfidInfo) as [key, value] (key)}
              <li>{key}: <strong>{value ?? "-"}</strong></li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if $ribbonRfidInfo}
        <button
          class="btn btn-sm btn-outline-secondary d-block w-100 mt-1"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#ribbonRfidInfo">
          Ribbon RFID info <MdIcon icon="expand_more" />
        </button>

        <div class="collapse" id="ribbonRfidInfo">
          <button class="btn btn-outline-secondary btn-sm mt-1" onclick={refreshRfidInfo}>Update</button>

          <ul>
            {#each Object.entries($ribbonRfidInfo) as [key, value] (key)}
              <li>{key}: <strong>{value ?? "-"}</strong></li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if $heartbeatData}
        <button
          class="btn btn-sm btn-outline-secondary d-block w-100 mt-1"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#heartbeatData">
          Heartbeat data <MdIcon icon="expand_more" />
        </button>

        <div class="collapse" id="heartbeatData">
          <ul>
            {#each Object.entries($heartbeatData) as [key, value] (key)}
              <li>{key}: <strong>{value ?? "-"}</strong></li>
            {/each}
          </ul>
        </div>
      {/if}

      <FirmwareUpdater />

      <button
        class="btn btn-sm btn-outline-secondary d-block w-100 mt-1"
        type="button"
        data-bs-toggle="collapse"
        data-bs-target="#tests">
        Tests <MdIcon icon="expand_more" />
      </button>

      <div class="collapse" id="tests">
        <div class="d-flex flex-wrap gap-1 mt-1">
          <button class="btn btn-sm btn-primary" onclick={startHeartbeat}>Heartbeat on</button>
          <button class="btn btn-sm btn-primary" onclick={stopHeartbeat}>Heartbeat off</button>
          <button class="btn btn-sm btn-primary" onclick={soundOn}>Sound on</button>
          <button class="btn btn-sm btn-primary" onclick={soundOff}>Sound off</button>
          <button class="btn btn-sm btn-primary" onclick={fetchInfo}>Fetch info again</button>
          <button class="btn btn-sm btn-primary" onclick={reset}>Reset</button>
        </div>
      </div>
    </div>
    <span class="input-group-text">
      <MdIcon icon="bluetooth" />
    </span>
    <span class="input-group-text {$heartbeatFails > 0 ? 'text-warning' : ''}">
      {$printerMeta?.model ?? $connectedPrinterName}
    </span>
    {#if $heartbeatData?.chargeLevel}
      <span class="input-group-text">
        <MdIcon icon={batteryIcon($heartbeatData.chargeLevel)} class="r-90"></MdIcon>
      </span>
    {/if}
  {:else}
    <button
      class="btn btn-primary"
      type="button"
      disabled={$connectionState === "connecting"}
      title="Connect to printer"
      onclick={onConnectClicked}>
      <MdIcon icon="bluetooth" />
    </button>
    <button
      class="btn btn-outline-secondary"
      type="button"
      disabled={$connectionState === "connecting"}
      title="Printer not listed? Show all nearby Bluetooth devices"
      onclick={onConnectAnyClicked}>
      <MdIcon icon="bluetooth_searching" />
    </button>
  {/if}

  {#if $connectionState === "connected"}
    <button class="btn btn-danger" onclick={onDisconnectClicked}>
      <MdIcon icon="power_off" />
    </button>
  {/if}
</div>

<style>
  .dropdown-menu {
    width: 100vw;
    max-width: 300px;
  }
</style>
