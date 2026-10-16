import { writable } from "svelte/store";

/** Visible on-page log of Bluetooth connection steps (handy on phones where there is no console). */
export const btLog = writable<string[]>([]);

export const logBt = (msg: string): void => {
  const t = new Date().toLocaleTimeString([], { hour12: false });
  console.log(`[bt] ${msg}`);
  btLog.update((lines) => [...lines.slice(-39), `${t} ${msg}`]);
};

export const clearBtLog = (): void => btLog.set([]);
