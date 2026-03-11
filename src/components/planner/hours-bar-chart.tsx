"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface HoursBarChartProps {
  data: Array<Record<string, number | string>>;
  bars: Array<{
    dataKey: string;
    fill: string;
  }>;
}

export function HoursBarChart({ data, bars }: HoursBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fill: "rgba(226,232,240,0.7)", fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "rgba(226,232,240,0.7)", fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.03)" }}
          contentStyle={{
            background: "rgba(15, 23, 42, 0.96)",
            border: "1px solid rgba(148, 163, 184, 0.16)",
            borderRadius: 16,
            color: "#f8fafc",
          }}
        />
        {bars.map((bar) => (
          <Bar
            key={bar.dataKey}
            dataKey={bar.dataKey}
            fill={bar.fill}
            radius={[10, 10, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
