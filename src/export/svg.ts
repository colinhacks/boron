import { FONT_NAME, ICON_FONT_NAME, embeddedFontCss, fontUsage } from "./fonts.ts";
import { buildOps, isGradient, textOps, type Op, type Paint } from "./paint.ts";
import type { Scene } from "./scene.ts";

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function escapeXml(value: string): string {
  // Strip C0 controls too: they are illegal in XML and would break the file.
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[&<>"]/g, (char) => XML_ESCAPES[char]!);
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

const FONT_STACK = `${FONT_NAME}, ${ICON_FONT_NAME}, ui-monospace, monospace`;

/**
 * SVG names its gradients, filters and clip paths in `<defs>` and refers to them
 * by id, where a canvas just carries the state — so emitting is two passes:
 * collect what has to be declared, then write the shapes that point at it.
 */
interface Defs {
  entries: string[];
  paintRef(paint: Paint): string;
  clipRef(op: Extract<Op, { op: "clip" }>): string;
  shadowRef(shadow: NonNullable<Extract<Op, { op: "panel" }>["shadow"]>): string;
}

function makeDefs(fontCss: string): Defs {
  const entries = [`<style type="text/css">${fontCss}</style>`];
  let next = 0;
  const id = () => `boron-${next++}`;

  return {
    entries,
    paintRef(paint) {
      if (!isGradient(paint)) return escapeXml(paint);
      const name = id();
      const stops = paint.stops
        .map((stop, index) => {
          const offset = paint.stops.length === 1 ? 0 : index / (paint.stops.length - 1);
          return `<stop offset="${round(offset)}" stop-color="${escapeXml(stop)}"/>`;
        })
        .join("");
      entries.push(
        `<linearGradient id="${name}" gradientUnits="userSpaceOnUse" x1="${round(paint.x0)}" y1="${round(paint.y0)}" x2="${round(paint.x1)}" y2="${round(paint.y1)}">${stops}</linearGradient>`,
      );
      return `url(#${name})`;
    },
    clipRef(op) {
      const name = id();
      entries.push(
        `<clipPath id="${name}"><rect x="${round(op.x)}" y="${round(op.y)}" width="${round(op.width)}" height="${round(op.height)}" rx="${op.radius}"/></clipPath>`,
      );
      return name;
    },
    shadowRef(shadow) {
      const name = id();
      entries.push(
        `<filter id="${name}" x="-50%" y="-50%" width="200%" height="200%">` +
          `<feDropShadow dx="0" dy="${shadow.offsetY}" stdDeviation="${shadow.stdDeviation}" flood-color="#000000" flood-opacity="${shadow.opacity}"/>` +
          `</filter>`,
      );
      return name;
    },
  };
}

function emit(ops: readonly Op[], defs: Defs): string {
  return ops
    .map((op) => {
      switch (op.op) {
        case "fill":
          return `<rect x="${round(op.x)}" y="${round(op.y)}" width="${round(op.width)}" height="${round(op.height)}" fill="${defs.paintRef(op.paint)}"/>`;

        case "panel": {
          const filter = op.shadow ? ` filter="url(#${defs.shadowRef(op.shadow)})"` : "";
          return `<rect x="${round(op.x)}" y="${round(op.y)}" width="${round(op.width)}" height="${round(op.height)}" rx="${op.radius}" fill="${escapeXml(op.fill)}"${filter}/>`;
        }

        case "circle":
          return `<circle cx="${round(op.cx)}" cy="${round(op.cy)}" r="${round(op.r)}" fill="${escapeXml(op.fill)}"/>`;

        case "text": {
          const attributes = [
            `x="${round(op.x)}"`,
            `y="${round(op.y)}"`,
            `font-family="${FONT_STACK}"`,
            `font-size="${round(op.size)}"`,
            op.bold ? 'font-weight="700"' : "",
            op.italic ? 'font-style="italic"' : "",
            `fill="${escapeXml(op.fill)}"`,
            op.centered ? 'text-anchor="middle" dominant-baseline="central"' : 'xml:space="preserve"',
          ].filter(Boolean);
          return `<text ${attributes.join(" ")}>${escapeXml(op.text)}</text>`;
        }

        case "clip":
          // The clip path has to be declared before the children are emitted, so
          // that ids come out in the same order the shapes ask for them.
          return `<g clip-path="url(#${defs.clipRef(op)})">${emit(op.children, defs)}</g>`;
      }
    })
    .join("");
}

/**
 * A standalone SVG with the font embedded, so the file renders identically
 * anywhere. Every run is positioned at the x we measured rather than left to
 * flow, which is what keeps the SVG and the PNG pixel-aligned.
 */
export async function renderToSvg(scene: Scene): Promise<string> {
  const { layout } = scene;
  const ops = buildOps(scene);
  const defs = makeDefs(await embeddedFontCss(fontUsage(textOps(ops))));
  const body = emit(ops, defs);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" ` +
    `viewBox="0 0 ${layout.width} ${layout.height}">` +
    `<defs>${defs.entries.join("")}</defs>${body}</svg>`
  );
}
