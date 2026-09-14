import type { ItineraryItem } from '@ghar/contracts';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * The trip's stops, plotted against each other.
 *
 * There are no map tiles here on purpose: tiles mean a third-party key, a request per pin
 * from every viewer, and something that goes blank in travel mode when there is no signal.
 * What this actually answers is "are these things near each other, and in what order" —
 * which needs relative positions and a scale bar, not streets. Each pin links out to a
 * real map for the times you want one.
 */
export function StopMap({
  items,
  className,
}: {
  items: readonly ItineraryItem[];
  className?: string;
}) {
  const stops = items.flatMap((item, index) =>
    item.lat === null || item.lng === null
      ? []
      : [{ id: item.id, title: item.title, lat: item.lat, lng: item.lng, number: index + 1 }],
  );

  return (
    <Card className={cn('p-4', className)}>
      <p className="text-sm font-medium">Stops</p>

      {stops.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">
          Give an itinerary item a latitude and longitude and it lands on this map.
        </p>
      ) : (
        <Plot stops={stops} />
      )}
    </Card>
  );
}

interface Stop {
  id: string;
  title: string;
  lat: number;
  lng: number;
  number: number;
}

const SIZE = 280;
const PADDING = 24;

function Plot({ stops }: { stops: Stop[] }) {
  const lats = stops.map((stop) => stop.lat);
  const lngs = stops.map((stop) => stop.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  // Longitude degrees shrink towards the poles, so scale them by the latitude we are at.
  const midLat = (minLat + maxLat) / 2;
  const lngScale = Math.max(Math.cos((midLat * Math.PI) / 180), 0.01);

  const width = Math.max((maxLng - minLng) * lngScale, 1e-6);
  const height = Math.max(maxLat - minLat, 1e-6);
  // One scale for both axes, so the shape of the trip is not stretched.
  const span = Math.max(width, height);
  const usable = SIZE - PADDING * 2;

  const place = (stop: Stop) => ({
    x: PADDING + usable / 2 + (((stop.lng - (minLng + maxLng) / 2) * lngScale) / span) * usable,
    // SVG y grows downwards; latitude grows upwards.
    y: PADDING + usable / 2 - ((stop.lat - midLat) / span) * usable,
  });

  const kilometres = span * 111;
  const scaleLabel =
    kilometres < 2
      ? `${Math.round(kilometres * 1000)} m across`
      : `${Math.round(kilometres)} km across`;

  return (
    <div className="mt-3 flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full rounded-control border border-line bg-paper"
        role="img"
        aria-label={`${stops.length} stops, ${scaleLabel}`}
      >
        <polyline
          points={stops.map((stop) => `${place(stop).x},${place(stop).y}`).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="3 3"
          className="text-line"
        />
        {stops.map((stop) => {
          const { x, y } = place(stop);
          return (
            <g key={stop.id} className="text-ink">
              <circle cx={x} cy={y} r={9} fill="currentColor" />
              <text
                x={x}
                y={y + 3.5}
                textAnchor="middle"
                fontSize={9}
                className="fill-surface"
                fontWeight={600}
              >
                {stop.number}
              </text>
            </g>
          );
        })}
      </svg>

      <p className="text-xs text-ink-muted">{scaleLabel}</p>

      <ol className="flex flex-col gap-1 text-sm">
        {stops.map((stop) => (
          <li key={stop.id} className="flex gap-2">
            <span className="w-5 shrink-0 tabular-nums text-ink-muted">{stop.number}</span>
            <a
              href={`https://www.openstreetmap.org/?mlat=${stop.lat}&mlon=${stop.lng}#map=15/${stop.lat}/${stop.lng}`}
              target="_blank"
              rel="noreferrer noopener"
              className="min-w-0 truncate underline underline-offset-4"
            >
              {stop.title}
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
