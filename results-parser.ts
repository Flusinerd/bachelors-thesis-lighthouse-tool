import { Result } from "lighthouse";

export function parseResults(results: Result[]) {
  const parsedResults: { [audit: string]: { [metric: string]: unknown } } = {};

  const audits = new Map<string, number[]>();
  for (const result of results) {
    for (const [audit, auditResult] of Object.entries(result.audits)) {
      if (auditResult.numericValue) {
        if (!audits.has(audit)) {
          audits.set(audit, []);
        }
        audits.get(audit)!.push(auditResult.numericValue);
      }
    }
  }

  for (const [audit, values] of audits) {
    parsedResults[audit] = {
      average: calculateAverage(values),
      median: calculateMedian(values),
      standardDeviation: calculateStandardDeviation(values),
      percentile95: calculatePercentile(values, 95),
      percentile99: calculatePercentile(values, 99),
      minMax: calculateMinMax(values),
      spread: calculateSpread(values),
      empiricalVariance: calculateEmpiricalVariance(values),
      variationCoefficient: calculateVariationCoefficient(values),
      values,
    };
  }

  return parsedResults
}

export function toCsv(results: { [audit: string]: { [metric: string]: unknown } }) {
  // TODO: Fix
  const header = results ? Object.keys(results).join(',') : ''
  const rows = results ? Object.values(results).map(result => Object.values(result).join(',')) : []
  return [header, ...rows].join('\n')
}

function calculateAverage(values: number[]) {
  return values.reduce((a, b) => a + b, 0) / values.length
}

function calculateMedian(values: number[]) {
  const sorted = values.sort()
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2
  }
  return sorted[middle]
}

function calculateStandardDeviation(values: number[]) {
  const average = calculateAverage(values)
  const squaredDiffs = values.map(value => Math.pow(value - average, 2))
  const averageSquaredDiffs = calculateAverage(squaredDiffs)
  return Math.sqrt(averageSquaredDiffs)
}

function calculatePercentile(values: number[], percentile: number) {
  const sorted = values.sort()
  const index = Math.ceil((percentile / 100) * sorted.length)
  return sorted[index]
}

function calculateMinMax(values: number[]) {
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

function calculateSpread(values: number[]) {
  const { min, max } = calculateMinMax(values)
  return max - min
}

function calculateEmpiricalVariance(values: number[]) {
  const average = calculateAverage(values)
  const diffs = values.map(value => Math.abs(value - average))
  return calculateAverage(diffs)
}

function calculateVariationCoefficient(values: number[]) {
  const average = calculateAverage(values)
  const standardDeviation = calculateStandardDeviation(values)
  return (standardDeviation / average) * 100
}

export function resultToCsv({audits}: Result) {
  const numericAudits = Object.entries(audits).sort((a, b) => a[0].localeCompare(b[0])).filter(([, audit]) => audit.numericValue !== undefined);
  const header = numericAudits.map(([audit]) => audit).join(',');
  const values = numericAudits.map(([, audit]) => audit.numericValue).join(',');

  return {
    header,
    values,
  }
}