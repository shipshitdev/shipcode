import { cn } from '@shipshitdev/ui';
import * as React from 'react';
import * as RechartsPrimitive from 'recharts';

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode;
    icon?: React.ComponentType;
    color?: string;
  }
>;

type ChartContextProps = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error('useChart must be used within a <ChartContainer />');
  }
  return context;
}

const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<'div'> & {
    config: ChartConfig;
    children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children'];
  }
>(({ id, className, children, config, ...props }, ref) => {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, '')}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        ref={ref}
        className={cn(
          'flex aspect-video justify-center text-xs',
          '[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground',
          '[&_.recharts-cartesian-grid_line[stroke]]:stroke-border/50',
          '[&_.recharts-radial-bar-background-sector]:fill-muted',
          '[&_.recharts-sector[stroke="#fff"]]:stroke-transparent',
          '[&_.recharts-sector]:outline-hidden',
          className,
        )}
        style={
          {
            ...Object.fromEntries(
              Object.entries(config).map(([key, value]) => [`--color-${key}`, value.color]),
            ),
          } as React.CSSProperties
        }
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
});
ChartContainer.displayName = 'ChartContainer';

const ChartTooltip = RechartsPrimitive.Tooltip;

function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
  const payloadObj = payload as Record<string, unknown> | undefined;
  const configLabelKey = typeof payloadObj?.dataKey === 'string' ? payloadObj.dataKey : key;
  return config[configLabelKey] ?? config[key];
}

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = 'dot',
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  nameKey,
  labelKey,
}: React.ComponentProps<typeof RechartsPrimitive.Tooltip> &
  React.ComponentProps<'div'> & {
    hideLabel?: boolean;
    hideIndicator?: boolean;
    indicator?: 'line' | 'dot' | 'dashed';
    nameKey?: string;
    labelKey?: string;
  }) {
  const { config } = useChart();

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) return null;
    const [item] = payload;
    const key = `${labelKey ?? item?.dataKey ?? item?.name ?? 'value'}`;
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    const value =
      !labelKey && typeof label === 'string' ? (config[label]?.label ?? label) : itemConfig?.label;
    if (labelFormatter)
      return <div className="font-medium">{labelFormatter(value as string, payload)}</div>;
    if (!value) return null;
    return <div className="font-medium">{value}</div>;
  }, [label, labelFormatter, payload, hideLabel, config, labelKey]);

  if (!active || !payload?.length) return null;
  const nestLabel = payload.length === 1 && indicator !== 'dot';

  return (
    <div
      className={cn(
        'grid min-w-32 items-start gap-1.5 rounded-lg border border-border/50 bg-primary px-2.5 py-1.5 text-xs shadow-xl',
        className,
      )}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload
          .filter((item) => item.type !== 'none')
          .map((item) => {
            const key = `${nameKey ?? item.name ?? item.dataKey ?? 'value'}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            const indicatorColor =
              ((item.payload as Record<string, unknown>)?.fill as string) ?? item.color;
            return (
              <div
                key={key}
                className={cn(
                  'flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground',
                  indicator === 'dot' && 'items-center',
                )}
              >
                {itemConfig?.icon ? (
                  <itemConfig.icon />
                ) : (
                  !hideIndicator && (
                    <div
                      className={cn('shrink-0 rounded-[2px] border-transparent bg-transparent', {
                        'h-2.5 w-2.5': indicator === 'dot',
                        'w-1': indicator === 'line',
                        'w-0 border-[1.5px] border-dashed bg-transparent': indicator === 'dashed',
                      })}
                      style={{
                        backgroundColor: indicator !== 'dashed' ? indicatorColor : undefined,
                        borderColor: indicator === 'dashed' ? indicatorColor : undefined,
                      }}
                    />
                  )
                )}
                {nestLabel ? tooltipLabel : null}
                <span className="text-muted-foreground">{itemConfig?.label ?? item.name}</span>
                <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
                  {typeof item.value === 'number' ? item.value.toLocaleString() : item.value}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

export { ChartContainer, ChartTooltip, ChartTooltipContent, useChart };
