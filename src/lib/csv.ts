/**
 * Escapes and neutralizes spreadsheet formula injection (CWE-1236) in CSV cells.
 * Values starting with =, +, -, @, tab, or carriage return are prefixed with a
 * leading single quote inside double quotes so Excel/LibreOffice/Sheets treat
 * them strictly as literal text.
 */
export function escapeCsvCell(value: unknown): string {
  const str = String(value ?? '');
  const neutralized = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${neutralized.replace(/"/g, '""')}"`;
}
