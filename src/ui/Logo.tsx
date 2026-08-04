/**
 * The Boron mark: a `B` drawn on a 5x7 terminal cell grid, each row taking one
 * step of a ramp sampled across the Boron theme's own ANSI colors.
 *
 * The colors are frozen here rather than read from the active theme, because
 * this is the product's mark — it should not restyle itself when someone
 * switches the document to Dracula. `logo-concepts/build-assets.mjs` generates
 * the standalone files in `public/` from the same grid and the same ramp.
 */

/** Filled cells of a 5x7 bitmap `B`, row-major. */
const ROWS = ["11110", "10001", "10001", "11110", "10001", "10001", "11110"];

/** One color per row, sampled across red → yellow → green → cyan → blue → magenta. */
const ROW_COLOR = ["#ff6b81", "#fcb134", "#85d461", "#36d9b7", "#37c4f2", "#70a0fa", "#c084fc"];

const CELL = 10;
const GAP = 1.5;
const WIDTH = 5 * CELL + 4 * GAP;
const HEIGHT = 7 * CELL + 6 * GAP;

export function Logo({ size = 18, title }: { size?: number; title?: string }) {
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      height={size}
      width={(size * WIDTH) / HEIGHT}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {ROWS.flatMap((row, r) =>
        [...row].map((on, c) =>
          on === "1" ? (
            <rect
              key={`${r}-${c}`}
              x={c * (CELL + GAP)}
              y={r * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={1.2}
              fill={ROW_COLOR[r]}
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
