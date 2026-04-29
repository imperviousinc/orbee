/**
 * Icons - inlined Phosphor (regular weight) SVG paths.
 * https://phosphoricons.com - MIT licensed. Copied verbatim from
 * phosphor-icons/core to avoid a third-party dependency.
 *
 * Usage:  <IconX />   <IconArrowDown size={20} />
 *
 * All icons render as an `<svg>` with `fill="currentColor"`, so color
 * follows CSS `color` on the parent (or the element itself).
 */
import type { JSX } from "solid-js";

interface IconProps {
  size?: number | string;
  class?: string;
  title?: string;
  style?: JSX.CSSProperties;
}

function Icon(props: IconProps & { children: JSX.Element }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      fill="currentColor"
      width={props.size ?? "1em"}
      height={props.size ?? "1em"}
      class={props.class}
      style={props.style}
      aria-hidden={props.title ? undefined : true}
      role={props.title ? "img" : undefined}
    >
      {props.title ? <title>{props.title}</title> : null}
      {props.children}
    </svg>
  );
}

export function IconX(p: IconProps = {}) {
  return (
    <Icon {...p}>
      <path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z" />
    </Icon>
  );
}

export function IconArrowDown(p: IconProps = {}) {
  return (
    <Icon {...p}>
      <path d="M205.66,149.66l-72,72a8,8,0,0,1-11.32,0l-72-72a8,8,0,0,1,11.32-11.32L120,196.69V40a8,8,0,0,1,16,0V196.69l58.34-58.35a8,8,0,0,1,11.32,11.32Z" />
    </Icon>
  );
}

export function IconDotsThreeVertical(p: IconProps = {}) {
  return (
    <Icon {...p}>
      <path d="M140,128a12,12,0,1,1-12-12A12,12,0,0,1,140,128ZM128,72a12,12,0,1,0-12-12A12,12,0,0,0,128,72Zm0,112a12,12,0,1,0,12,12A12,12,0,0,0,128,184Z" />
    </Icon>
  );
}

export function IconWarningCircle(p: IconProps = {}) {
  return (
    <Icon {...p}>
      <path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm-8-80V80a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,172Z" />
    </Icon>
  );
}

export function IconPlus(p: IconProps = {}) {
  return (
    <Icon {...p}>
      <path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z" />
    </Icon>
  );
}

export function IconPaperPlaneTilt(p: IconProps = {}) {
  return (
    <Icon {...p}>
      <path d="M227.32,28.68a16,16,0,0,0-15.66-4.08l-.15,0L19.57,82.84a16,16,0,0,0-2.49,29.8L102,154l41.3,84.87A15.86,15.86,0,0,0,157.74,248q.69,0,1.38-.06a15.88,15.88,0,0,0,14-11.51l58.2-191.94c0-.05,0-.1,0-.15A16,16,0,0,0,227.32,28.68ZM157.83,231.85l-.05.14,0-.07-40.06-82.3,48-48a8,8,0,0,0-11.31-11.31l-48,48L24.08,98.25l-.07,0,.14,0L216,40Z" />
    </Icon>
  );
}

export function IconSmiley(p: IconProps = {}) {
  return (
    <Icon {...p}>
      <path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216ZM80,108a12,12,0,1,1,12,12A12,12,0,0,1,80,108Zm96,0a12,12,0,1,1-12-12A12,12,0,0,1,176,108Zm-1.07,48c-10.29,17.79-27.4,28-46.93,28s-36.63-10.2-46.92-28a8,8,0,1,1,13.84-8c7.47,12.91,19.21,20,33.08,20s25.61-7.1,33.07-20a8,8,0,0,1,13.86,8Z" />
    </Icon>
  );
}

export function IconMagnifyingGlass(p: IconProps = {}) {
  return (
    <Icon {...p}>
      <path d="M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z" />
    </Icon>
  );
}

export function IconCopy(p: IconProps = {}) {
  return (
    <Icon {...p}>
      <path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z" />
    </Icon>
  );
}

export function IconArrowBendUpLeft(p: IconProps = {}) {
  return (
    <Icon {...p}>
      <path d="M232,200a8,8,0,0,1-16,0,88.1,88.1,0,0,0-88-88H51.31l34.35,34.34a8,8,0,0,1-11.32,11.32l-48-48a8,8,0,0,1,0-11.32l48-48A8,8,0,0,1,85.66,61.66L51.31,96H128A104.11,104.11,0,0,1,232,200Z" />
    </Icon>
  );
}

export function IconShuffle(p: IconProps = {}) {
  return (
    <Icon {...p}>
      <path d="M237.66,178.34a8,8,0,0,1,0,11.32l-24,24a8,8,0,0,1-11.32-11.32L212.69,192H200a72.15,72.15,0,0,1-57.65-28.8l-27.2-36.27a56.1,56.1,0,0,0-44.85-22.4H32a8,8,0,0,1,0-16H70.3a72.15,72.15,0,0,1,57.65,28.8l27.2,36.27a56.1,56.1,0,0,0,44.85,22.4h12.69L202.34,164.34a8,8,0,0,1,11.32-11.32ZM152,96a7.94,7.94,0,0,0,4.8-1.6L170.13,84A56.1,56.1,0,0,1,200,76h12.69L202.34,84.34a8,8,0,0,0,11.32,11.32l24-24a8,8,0,0,0,0-11.32l-24-24a8,8,0,0,0-11.32,11.32L212.69,60H200a72.15,72.15,0,0,0-38.66,11.2L148,80.8a8,8,0,0,0,4,14.4ZM104,160a7.94,7.94,0,0,0-4.8,1.6L85.87,172A56.1,56.1,0,0,1,56,180H32a8,8,0,0,0,0,16H56A72.15,72.15,0,0,0,94.66,184.8L108,175.2a8,8,0,0,0-4-15.2Z" />
    </Icon>
  );
}

export function IconTrash(p: IconProps = {}) {
  return (
    <Icon {...p}>
      <path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z" />
    </Icon>
  );
}

export function IconPushPin(p: IconProps = {}) {
  // Simple pin glyph: rectangular head at top, triangular shaft, vertical
  // line below. Kept hand-drawn rather than copying Phosphor's push-pin
  // to avoid the risk of a bad path paste.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      width={p.size ?? "1em"}
      height={p.size ?? "1em"}
      class={p.class}
      style={p.style}
      aria-hidden={p.title ? undefined : true}
    >
      {p.title ? <title>{p.title}</title> : null}
      <path d="M9 4h6l-1 5 3 3H7l3-3-1-5z" />
      <line x1="12" y1="15" x2="12" y2="21" />
    </svg>
  );
}

// Phosphor LockSimple - clean padlock silhouette with no interior pin.
// Used as the verified-handle indicator: sits next to the bubble time,
// tinted orange when the author's sovereign handle is pinned to a
// trusted anchor (displayState === "orange").
export function IconLockSimple(p: IconProps = {}) {
  return (
    <Icon {...p}>
      <path d="M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80ZM96,56a32,32,0,0,1,64,0V80H96ZM208,208H48V96H208V208Z" />
    </Icon>
  );
}

export function IconHandsClapping(p: IconProps = {}) {
  return (
    <Icon {...p}>
      <path d="M160.22,24V8a8,8,0,0,1,16,0V24a8,8,0,0,1-16,0ZM196.1,41a7.91,7.91,0,0,0,4.17,1.17,8,8,0,0,0,6.84-3.83l8-13.11a8,8,0,0,0-13.68-8.33l-8,13.1A8,8,0,0,0,196.1,41Zm47.51,12.59a8,8,0,0,0-10.08-5.16l-15.06,4.85a8,8,0,0,0,2.46,15.62,8.15,8.15,0,0,0,2.46-.39l15.05-4.85A8,8,0,0,0,243.61,53.55ZM217,97.58a80.22,80.22,0,0,1-10.22,94c-.34,1.73-.72,3.46-1.19,5.18A80.17,80.17,0,0,1,58.77,216L23.5,155a26,26,0,0,1,19.24-38.79l-3-5.2a26,26,0,0,1,19.2-38.78L58.24,71A26,26,0,0,1,95.47,36.53,26.06,26.06,0,0,1,140.3,37l12.26,21.2A26.07,26.07,0,0,1,195.81,61ZM109.07,55l0,0h0l25,43.17a26,26,0,0,1,17.33-10L126.42,45a10,10,0,1,0-17.35,10ZM72.12,63l6.46,11.17a26.05,26.05,0,0,1,17.32-10L89.45,53A10,10,0,1,0,72.12,63Zm111.54,81-20.22-35a10,10,0,0,0-17.74,9.25L158.3,140a8,8,0,0,1-13.87,8l-36.5-63A10,10,0,1,0,90.58,95l26.05,45a8,8,0,0,1-13.87,8L71,93h0l0,0a10,10,0,0,0-17.33,10l35.22,61A8,8,0,0,1,75,172L54.72,137a10,10,0,0,0-17.34,10l35.27,61a64.12,64.12,0,0,0,117.42-15.44A63.52,63.52,0,0,0,183.66,144Zm19.41-38.42L181.93,69A10,10,0,0,0,164.55,79l33,57.05A80.2,80.2,0,0,1,207,161.51,64.23,64.23,0,0,0,203.07,105.58Z" />
    </Icon>
  );
}