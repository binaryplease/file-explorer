// Compact byte formatting in the broot style: "421K", "1.9M", "88M".
export function formatBytes(sizeBytes: number | null): string {
  if (sizeBytes === null) return ''
  if (sizeBytes < 1024) return `${sizeBytes} B`
  const unitSuffixes = ['K', 'M', 'G', 'T']
  let unitIndex = -1
  let scaledValue = sizeBytes
  do {
    scaledValue /= 1024
    unitIndex++
  } while (scaledValue >= 1024 && unitIndex < unitSuffixes.length - 1)
  const rendered = scaledValue < 10 ? scaledValue.toFixed(1) : String(Math.round(scaledValue))
  return `${rendered}${unitSuffixes[unitIndex]}`
}

export const LARGE_FILE_THRESHOLD_BYTES = 50 * 1024 * 1024
