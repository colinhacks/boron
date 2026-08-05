import { gradientEndpoints } from "./background.ts";
import { FONT_NAME, embeddedFontCss } from "./fonts.ts";
import { trafficLights } from "./layout.ts";
import { CHROME_TITLE_SCALE, chromeBorderColor, chromeTitleColor, resolveShadow, type Scene } from "./scene.ts";

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

/**
 * A standalone SVG with the font embedded, so the file renders identically
 * anywhere. Every run is positioned at the x we measured on canvas rather than
 * left to flow, which is what keeps the SVG and PNG pixel-aligned.
 */
export async function renderToSvg(scene: Scene): Promise<string> {
  const { layout, frame, theme, background } = scene;
  const { terminal } = layout;
  const fontCss = await embeddedFontCss();

  const defs: string[] = [`<style type="text/css">${fontCss}</style>`];

  if (background) {
    const { x0, y0, x1, y1 } = gradientEndpoints(background.angle, layout.width, layout.height);
    const stops = background.stops
      .map((stop, index) => {
        const offset = background.stops.length === 1 ? 0 : index / (background.stops.length - 1);
        return `<stop offset="${round(offset)}" stop-color="${escapeXml(stop)}"/>`;
      })
      .join("");
    defs.push(
      `<linearGradient id="boron-bg" gradientUnits="userSpaceOnUse" x1="${round(x0)}" y1="${round(y0)}" x2="${round(x1)}" y2="${round(y1)}">${stops}</linearGradient>`,
    );
  }

  const shadow = resolveShadow(frame.shadowStrength);
  if (shadow) {
    defs.push(
      `<filter id="boron-shadow" x="-50%" y="-50%" width="200%" height="200%">` +
        `<feDropShadow dx="0" dy="${shadow.offsetY}" stdDeviation="${shadow.stdDeviation}" flood-color="#000000" flood-opacity="${shadow.opacity}"/>` +
        `</filter>`,
    );
  }

  defs.push(
    `<clipPath id="boron-clip"><rect x="${round(terminal.x)}" y="${round(terminal.y)}" width="${round(terminal.width)}" height="${round(terminal.height)}" rx="${frame.radius}"/></clipPath>`,
  );

  const body: string[] = [];

  if (background) {
    body.push(`<rect x="0" y="0" width="${layout.width}" height="${layout.height}" fill="url(#boron-bg)"/>`);
  }

  body.push(
    `<rect x="${round(terminal.x)}" y="${round(terminal.y)}" width="${round(terminal.width)}" height="${round(terminal.height)}" rx="${frame.radius}" fill="${escapeXml(theme.background)}"${shadow ? ' filter="url(#boron-shadow)"' : ""}/>`,
  );

  const clipped: string[] = [];

  if (frame.showChrome) {
    clipped.push(
      `<rect x="${round(terminal.x)}" y="${round(terminal.y + layout.chromeHeight - 1)}" width="${round(terminal.width)}" height="1" fill="${escapeXml(chromeBorderColor(theme))}"/>`,
    );
    for (const light of trafficLights(layout, frame)) {
      clipped.push(
        `<circle cx="${round(light.cx)}" cy="${round(light.cy)}" r="${round(light.r)}" fill="${escapeXml(light.fill)}"/>`,
      );
    }
    if (frame.title) {
      clipped.push(
        `<text x="${round(terminal.x + terminal.width / 2)}" y="${round(terminal.y + layout.chromeHeight / 2)}" ` +
          `font-family="${FONT_NAME}, ui-monospace, monospace" font-size="${round(layout.fontSize * CHROME_TITLE_SCALE)}" ` +
          `fill="${escapeXml(chromeTitleColor(theme))}" text-anchor="middle" dominant-baseline="central">${escapeXml(frame.title)}</text>`,
      );
    }
  }

  for (const line of layout.lines) {
    for (const span of line.spans) {
      if (!span.style.background) continue;
      clipped.push(
        `<rect x="${round(terminal.x + span.x)}" y="${round(terminal.y + line.top)}" width="${round(span.width)}" height="${layout.lineHeight}" fill="${escapeXml(span.style.background)}"/>`,
      );
    }
    for (const span of line.spans) {
      if (span.style.opacity === 0) continue;
      const x = terminal.x + span.x;
      const y = terminal.y + line.baseline;
      const attributes = [
        `x="${round(x)}"`,
        `y="${round(y)}"`,
        `font-family="${FONT_NAME}, ui-monospace, monospace"`,
        `font-size="${round(layout.fontSize)}"`,
        span.style.bold ? 'font-weight="700"' : "",
        span.style.italic ? 'font-style="italic"' : "",
        `fill="${escapeXml(span.style.color)}"`,
        'xml:space="preserve"',
      ].filter(Boolean);
      clipped.push(`<text ${attributes.join(" ")}>${escapeXml(span.text)}</text>`);

      const thickness = Math.max(1, Math.round(layout.fontSize / 14));
      if (span.style.underline) {
        clipped.push(
          `<rect x="${round(x)}" y="${round(y + layout.fontSize * 0.14)}" width="${round(span.width)}" height="${thickness}" fill="${escapeXml(span.style.color)}"/>`,
        );
      }
      if (span.style.strikethrough) {
        clipped.push(
          `<rect x="${round(x)}" y="${round(y - layout.fontSize * 0.28)}" width="${round(span.width)}" height="${thickness}" fill="${escapeXml(span.style.color)}"/>`,
        );
      }
    }
  }

  body.push(`<g clip-path="url(#boron-clip)">${clipped.join("")}</g>`);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" ` +
    `viewBox="0 0 ${layout.width} ${layout.height}">` +
    `<defs>${defs.join("")}</defs>${body.join("")}</svg>`
  );
}
