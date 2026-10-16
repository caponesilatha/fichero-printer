<script lang="ts">
  import { Utils } from "$/lib/fichero";
  import { tr } from "$/utils/i18n";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { detectAntiFingerprinting } from "$/utils/browsers";
  let caps = Utils.getAvailableTransports();

  let antiFingerprinting = detectAntiFingerprinting();
  let isIOS = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
  let isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
  let insecure = typeof window !== "undefined" && !window.isSecureContext;
</script>

{#if !caps.webBluetooth}
  <div class="alert alert-danger text-center" role="alert">
    {#if insecure}
      Web Bluetooth only works on HTTPS pages (or localhost). Open the https:// address of this app.
    {:else if isIOS}
      <MdIcon icon="computer" />
      iPhone/iPad browsers don't support Web Bluetooth. Use Chrome, Edge, or Opera on Android or a computer
      (or a Web Bluetooth capable iOS browser such as Bluefy).
    {:else if isAndroid}
      Web Bluetooth isn't available in this browser. Open this page in Chrome on Android.
    {:else}
      <div>
        {$tr("browser_warning.lines.first")}
      </div>
      <div>
        {$tr("browser_warning.lines.second")}
      </div>
    {/if}
  </div>
{/if}

{#if antiFingerprinting}
  <div class="alert alert-danger" role="alert">
    {$tr("browser_warning.fingerprinting")}
  </div>
{/if}

<style>
</style>
