import { Show } from "solid-js";
import type { IdentityParts } from "../lib/profiles";

/** Renders the identity's primary token: npub (faded prefix/ellipsis),
 *  subdomain handle (faded namespace tail), or bare handle. */
export default function IdentityPrimary(props: { identity: IdentityParts }) {
  return (
    <Show when={props.identity.npubParts} fallback={<HandleText text={props.identity.primary} />}>
      {(parts) => (
        <>
          <span class="npub-fade">{parts().prefix}</span>
          {parts().head}
          <span class="npub-fade">…</span>
          {parts().tail}
        </>
      )}
    </Show>
  );
}

/** Splits a handle into leaf + tail at the leftmost `.` before the `@`. */
function splitHandle(handle: string): { leaf: string; tail?: string } {
  const atIdx = handle.indexOf("@");
  if (atIdx <= 0) return { leaf: handle };
  const dotIdx = handle.slice(0, atIdx).indexOf(".");
  if (dotIdx <= 0) return { leaf: handle };
  return { leaf: handle.slice(0, dotIdx), tail: handle.slice(dotIdx) };
}

function HandleText(props: { text: string }) {
  const parts = () => splitHandle(props.text);
  return (
    <Show when={parts().tail} fallback={props.text}>
      {(tail) => (
        <>
          {parts().leaf}
          <span class="handle-tail">{tail()}</span>
        </>
      )}
    </Show>
  );
}
