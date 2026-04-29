// Side-effect imports for non-JS assets handled by vite. Without these
// ambient declarations, `import "./index.css"` and friends fail tsc.

declare module "*.css";
declare module "*.svg";
declare module "*.png";
declare module "*.jpg";
declare module "*.webp";
