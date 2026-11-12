import type { JSX } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from 'recharts';
import type { Finding, Severity } from '@sentinel/contracts';
import { severityDistribution } from '../lib/dashboard';

const SEVERITY_COLORS: Readonly<Record<Severity, string>> = {
  CRITICAL: '#f87171',
  HIGH: '#ef4444',
  MEDIUM: '#fbbf24',
  LOW: '#38bdf8',
};

function isSeverity(value: unknown): value is Severity {
  return value === 'CRITICAL' || value === 'HIGH' || value === 'MEDIUM' || value === 'LOW';
}

function renderSeverityBar(props: BarShapeProps): JSX.Element {
  const payload: unknown = props.payload;
  const severity =
    typeof payload === 'object' && payload !== null && 'severity' in payload
      ? payload.severity
      : undefined;
  if (!isSeverity(severity)) {
    throw new Error('Severity chart received an invalid data point.');
  }

  return <Rectangle {...props} fill={SEVERITY_COLORS[severity]} />;
}

export interface SeverityDistributionChartProps {
  readonly findings: readonly Finding[];
}

export function SeverityDistributionChart({
  findings,
}: SeverityDistributionChartProps): JSX.Element {
  const data = severityDistribution(findings);

  return (
    <figure
      className="mt-4 rounded-lg border border-slate-700 bg-sentinel-panel p-4"
      aria-labelledby="severity-distribution-title"
      data-testid="severity-distribution-chart"
    >
      <figcaption
        id="severity-distribution-title"
        className="mb-3 text-sm font-semibold text-slate-100"
      >
        Findings by severity
      </figcaption>
      <div role="img" aria-label="Bar chart showing findings for each severity level">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 16, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis dataKey="severity" tick={{ fill: '#cbd5e1', fontSize: 12 }} />
            <YAxis allowDecimals={false} width={32} tick={{ fill: '#cbd5e1', fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="count" name="Findings" shape={renderSeverityBar} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Exact finding count by severity</caption>
        <thead>
          <tr>
            <th scope="col">Severity</th>
            <th scope="col">Findings</th>
          </tr>
        </thead>
        <tbody>
          {data.map(({ severity, count }) => (
            <tr key={severity} data-testid={`severity-distribution-${severity}`}>
              <th scope="row">{severity}</th>
              <td>{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
