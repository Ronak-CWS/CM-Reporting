/** Shared saved values for the PDF and photo-inclusive Excel report. */
export function blockedCallReport(database, id) {
  const report = database.prepare('SELECT * FROM report_records WHERE id = ?').get(id);
  if (!report) throw new Error('Report not found.');
  const blockage = database.prepare('SELECT * FROM report_blockages WHERE record_id = ?').get(id);
  if (report.record_type !== 'daily' || !blockage) return null;
  const photos = database.prepare('SELECT * FROM report_photos WHERE record_id = ? ORDER BY position, id').all(id);
  if (!photos.length || photos.length > 6) throw new Error('Report evidence is incomplete.');
  return { report, blockage, photos };
}

export function dailyBlockedCallReports(database, ids, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid report date.');
  return [...new Set(ids)].map((id) => {
    const entry = blockedCallReport(database, id);
    if (!entry || entry.report.occurred_at.slice(0, 10) !== day) throw new Error('Report is outside the requested day.');
    return entry;
  });
}

export function cleanReportText(value) {
  return String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/\t/g, '    ');
}

/** Rows contain one full-width field or two side-by-side fields. */
export function blockedCallDetailRows({ report, blockage }) {
  const joined = (values, separator = ' / ') => values.filter(Boolean).join(separator);
  return [
    [['Location', report.site_address || report.customer_address]],
    [['Community', report.registered_community], ['Route / service', joined([report.route_number, report.service_type])]],
    [['Occurred', report.occurred_at.replace('T', ' ')], ['Reported by', report.employee_name]],
    [['Status / priority', joined([report.status, report.priority])],
      ['Blockage', `${blockage.scope === 'street' ? 'Street' : 'Pickup'} - ${blockage.reason_label}`]],
    [['Street section', joined([blockage.street_from, blockage.street_to], ' to ')], ['Vehicle plates', blockage.vehicle_plates]],
    [['Description', report.issue_description]],
    [['Notes', blockage.notes !== report.issue_description ? blockage.notes : '']],
    [['Corrective action', report.corrective_action]],
    [['Assigned to', report.assigned_to]],
    [['Resolution', report.resolution_description]],
    [['Resolution due', report.resolution_due_at], ['Resolved at', report.resolved_at]],
  ].map((row) => row.filter(([, value]) => Boolean(value)).map(([label, value]) => [label, cleanReportText(value)]))
    .filter((row) => row.length);
}
