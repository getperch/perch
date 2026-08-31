/**
 * Perch brand mark — one bird, one colour, no outlines (see `Perch Identity.dc.html`). The beak is
 * knocked out of the single shape rather than drawn, so the mark holds at any size and works on any
 * background with no second version to maintain.
 *
 * - `PerchMark`     — the bird as a single filled shape. `color` defaults to Iris; pass a light
 *                     value when it sits on a dark surface.
 * - `PerchGlyph`    — the bird knocked into a rounded tile (agent avatars, favicon, dense rails).
 * - `PerchWordmark` — mark + "perch" set lowercase in Space Grotesk 600, tracked -5%.
 *
 * SVG paths are lifted verbatim from the identity file; `fill-rule="evenodd"` punches the beak
 * (`BEAK_D`) out of the body (`SILHOUETTE_D`).
 */
import type { CSSProperties } from "react";
import { font } from "./tokens.js";

const VIEW_BOX = "0 0 118 131";
const MATRIX = "matrix(0.180982 0 0 0.18144 -26.6044 -29.2119)";

/** The bird body as one continuous outline. */
const SILHOUETTE_D =
  "M473.211 402.973C502.36 359.895 531.853 317.051 561.686 274.444L588.514 235.604C594.775 226.438 606.216 208.893 614.117 201.461C628.303 188.163 645.918 179.088 664.981 175.255C691.558 170.308 719.012 176.111 741.314 191.391C763.084 206.428 778.919 230.7 783.899 256.756C785.679 266.072 785.186 282.155 785.195 292.169L785.39 339.804L785.468 458.283C785.457 481.513 786.519 517.109 782.663 538.805C778.053 565.186 767.711 590.234 752.367 612.182C724.739 651.843 682.389 678.798 634.761 687.035C618.684 689.799 606.506 689.551 590.302 689.577L552.684 689.601L506.167 689.561C495.861 689.534 483.755 689.651 473.528 688.997L470.623 690.17L252.159 815.674C220.213 833.928 185.932 854.938 153.533 871.748L223.34 769.797C229.108 761.486 234.798 753.12 240.408 744.702C242.345 741.802 248.216 732.748 250.184 730.594C251.528 728.182 253.104 725.894 254.606 723.578C264.278 708.665 274.478 694.107 284.454 679.4L354.821 576.494L439.189 452.15C450.466 435.673 461.395 419.063 473.211 402.973Z";

/** The beak — subtracted from the body via evenodd so it reads as a transparent notch. */
const BEAK_D =
  "M620.455 268.173C638.491 267.757 657.105 268.066 675.213 268.051C697.41 267.907 719.608 267.942 741.805 268.159C730.207 284.626 718.412 300.954 706.425 317.139C698.111 328.703 689.706 340.201 681.212 351.633C673.63 342.776 665.819 330.93 658.773 321.18L620.455 268.173Z";

const MARK_D = `${SILHOUETTE_D} ${BEAK_D}`;

export function PerchMark({
  size = 28,
  color = "#7D35EB",
  style,
}: {
  size?: number;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={(size * 131) / 118}
      viewBox={VIEW_BOX}
      fill="none"
      style={style}
      role="img"
      aria-label="Perch"
    >
      <path fill={color} fillRule="evenodd" transform={MATRIX} d={MARK_D} />
    </svg>
  );
}

/** The bird knocked into a rounded tile. Defaults to a light bird on an Iris tile (the identity's
 *  small-size treatment); pass `tile`/`bird` to match an agent's own colours. */
export function PerchGlyph({
  size = 28,
  tile = "#7D35EB",
  bird = "#F7F5FA",
  radius,
  style,
}: {
  size?: number;
  tile?: string;
  bird?: string;
  radius?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius ?? Math.max(6, Math.round(size * 0.29)),
        background: tile,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        ...style,
      }}
    >
      <svg
        width={size * 0.62}
        height={(size * 0.62 * 131) / 118}
        viewBox={VIEW_BOX}
        fill="none"
        role="img"
        aria-label="Perch"
      >
        <path fill={bird} fillRule="evenodd" transform={MATRIX} d={MARK_D} />
      </svg>
    </div>
  );
}

export function PerchWordmark({
  size = 28,
  onDark = false,
  style,
}: {
  size?: number;
  onDark?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: Math.round(size * 0.34), ...style }}>
      <PerchMark size={size} color={onDark ? "#F7F5FA" : "#7D35EB"} />
      <span
        style={{
          fontFamily: font.display,
          fontWeight: 600,
          fontSize: Math.round(size * 0.92),
          letterSpacing: "-0.05em",
          color: onDark ? "#F7F5FA" : "#413D4E",
          lineHeight: 1,
        }}
      >
        perch
      </span>
    </div>
  );
}
