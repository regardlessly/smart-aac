'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

const ROOM_COLORS = [
  '#0d9488', // teal
  '#0ea5e9', // sky
  '#eab308', // amber
  '#ef4444', // coral
  '#8b5cf6', // purple
  '#f97316', // orange
  '#22c55e', // green
  '#ec4899', // pink
]

interface ChartRoom {
  id: number
  name: string
}

interface Props {
  chartData: Record<string, unknown>[]
  chartRooms: ChartRoom[]
}

export default function OccupancyChart({ chartData, chartRooms }: Props) {
  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#e2e8f0"
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: '#94a3b8' }}
          />
          <YAxis
            tick={{ fontSize: 12, fill: '#94a3b8' }}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              fontSize: '12px',
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: '12px' }}
          />
          {chartRooms.map((room, i) => (
            <Bar
              key={room.id}
              dataKey={`room_${room.id}`}
              name={room.name}
              fill={ROOM_COLORS[i % ROOM_COLORS.length]}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
