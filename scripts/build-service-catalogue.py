"""Read the reviewed C9 and Wood Buffalo service snapshots into the reporting catalogue.

Uses the standard library only. Source CSVs/workbooks are never changed.
"""
import argparse
import csv
import hashlib
import json
import re
import posixpath
from collections import Counter, defaultdict
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET


def read_csv(path):
    with path.open(encoding='utf-8-sig', newline='') as handle:
        return list(csv.DictReader(handle))


def xlsx_rows(path, tables_only=False):
    ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with ZipFile(path) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = [''.join(el.text or '' for el in si.iterfind('.//s:t', ns)) for si in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        relationships = {el.attrib['Id']: el.attrib['Target'] for el in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        for sheet in ET.fromstring(archive.read('xl/workbook.xml')).findall('s:sheets/s:sheet', ns):
            target = relationships[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
            target = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            worksheet = ET.fromstring(archive.read(target))
            bounds = []
            if tables_only:
                rel_path = posixpath.join(posixpath.dirname(target), '_rels', posixpath.basename(target) + '.rels')
                if rel_path in archive.namelist():
                    for rel in ET.fromstring(archive.read(rel_path)):
                        if rel.attrib['Type'].endswith('/table'):
                            table_path = rel.attrib['Target']
                            table_path = table_path.lstrip('/') if table_path.startswith('/') else posixpath.normpath(posixpath.join(posixpath.dirname(target), table_path))
                            table = ET.fromstring(archive.read(table_path))
                            bounds.append(tuple(int(re.sub(r'\D', '', cell)) for cell in table.attrib['ref'].split(':')))
            rows = []
            for row in worksheet.findall('s:sheetData/s:row', ns):
                if tables_only and not any(start <= int(row.attrib['r']) <= end for start, end in bounds): continue
                values = {}
                for cell in row.findall('s:c', ns):
                    value = cell.findtext('s:v', '', ns)
                    if cell.attrib.get('t') == 's': value = strings[int(value)] if value else ''
                    if cell.attrib.get('t') == 'inlineStr': value = ''.join(el.text or '' for el in cell.iterfind('.//s:t', ns))
                    values[''.join(c for c in cell.attrib['r'] if c.isalpha())] = value
                rows.append((int(row.attrib['r']), values))
            yield sheet.attrib['name'], rows


def clean(value):
    return re.sub(r'\s+', ' ', str(value or '')).strip()


def unit_text(value):
    return re.sub(r'^(?:UNIT\s*|#\s*)', '', clean(value), flags=re.I).strip(' ,')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


# Keep the spelling already used by the reviewed routes and reporting catalogue.
C9_COMMUNITY_NAMES = {'Beaver Mine': 'Beaver Mines'}


def c9_community(value):
    name = clean(value)
    return C9_COMMUNITY_NAMES.get(name, name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('data/service-locations.json'))
    args = parser.parse_args()
    root = args.source_root.resolve()
    c9_dir = root / 'outputs/2026-09-21_parkland_estates_raymond_32'
    wb_dir = root / 'cws-section-route-optimizer/outputs/wood-buffalo-weekday-routes-2026-08-26-client-adjusted-final'
    paths = {
        'c9_routes': c9_dir / 'optimized_routes.csv',
        'c9_source': c9_dir / 'Addresses of Communities For Collective Waste - Parkland Estates 32 Units 2026-09-21.xlsx',
        'c9_reviewed_workbook': root / 'playground/Combining Maps/C9_route_addresses_maps_final.xlsx',
        'enchant_source': root / 'c9-address-router/data/add-ons/Alberta Address Collection - Hamlet of Enchant with Mailing Address.xlsx',
        'hays_source': root / 'c9-address-router/data/add-ons/Alberta Address Collection - Hamlet of Hays with Mailing Address.xlsx',
        'c9_previous': root / 'outputs/2026-09-18_all_additions_brooks_mobile_home_17925/optimized_routes.csv',
        'brooks_additions': root / 'outputs/2026-09-18_brooks_mobile_home_additions_source_386/Brooks_mobile_home_routing_additions.csv',
        'wood_buffalo_routes': wb_dir / 'max_3_trucks/optimized_routes.csv',
        'wood_buffalo_source': root / 'CM-Wood Buffalo/data/source/Customers.xlsx',
    }
    before = {name: digest(path) for name, path in paths.items()}
    c9, wb = read_csv(paths['c9_routes']), read_csv(paths['wood_buffalo_routes'])
    assert len(c9) == len({row['service_id'] for row in c9}) == 17956
    assert len(wb) == len({row['service_id'] for row in wb}) == 19458
    parkland = [row for row in c9 if row['street_name'] == 'Parkland Estates']
    expected_units = {str(i) for i in range(1, 31)} | {'8B', '9B'}
    assert len(parkland) == 32 and {row['unit'] for row in parkland} == expected_units
    assert all(not row['street_number'] for row in parkland)
    previous_ids = {row['service_id'] for row in read_csv(paths['c9_previous'])}
    current_ids = {row['service_id'] for row in c9}
    assert len(previous_ids - current_ids) == 1
    assert current_ids - previous_ids == {row['service_id'] for row in parkland}
    additions = read_csv(paths['brooks_additions'])
    assert len(additions) == 386
    addition_ids = {row.get('service_id') or row.get('real_service_id') for row in additions}
    assert None not in addition_ids and addition_ids <= current_ids
    counts = Counter(row['service_community'] for row in c9)
    assert counts['Brooks'] == 4056 and counts['Enchant'] == 119 and counts['Hays'] == 73

    # Every route address and unit must agree with the reviewed delivery workbook.
    final_addresses = Counter()
    for sheet, rows in xlsx_rows(paths['c9_reviewed_workbook'], tables_only=True):
        if sheet == 'Route Index': continue
        for number, values in rows:
            if number > 7 and clean(values.get('A')) and clean(values.get('C')):
                final_addresses[tuple(clean(value).upper() for value in [values.get('A'), values.get('B'), values.get('C'), unit_text(values.get('D'))])] += 1
    route_addresses = Counter(tuple(clean(row[field]).upper() for field in ['service_community', 'subarea', 'full_address']) + (unit_text(row['unit']).upper(),) for row in c9)
    assert final_addresses == route_addresses, 'Route CSV and reviewed C9 address workbook differ.'

    addon_checks = {}
    for locality in ['Enchant', 'Hays']:
        # Explicitly select Service Address; never inspect/import the Mailing Address sheet.
        rows = dict(next(rows for name, rows in xlsx_rows(paths[f'{locality.lower()}_source']) if name == 'Service Address'))
        source_rows = {number for number, values in rows.items() if number >= 33 and clean(values.get('B')) and clean(values.get('C'))}
        routed = [row for row in c9 if row['service_community'] == locality]
        assert source_rows == {int(row['source_excel_row']) for row in routed}
        for row in routed:
            original = rows[int(row['source_excel_row'])]
            assert unit_text(original.get('A')).upper() == unit_text(row['unit']).upper()
            assert clean(original.get('B')).upper() == clean(row['street_number']).upper()
            assert clean(row['street_name']).upper().startswith(clean(original.get('C')).upper())
        addon_checks[locality] = len(source_rows)

    # Reconcile the current source workbook independently of the route IDs.
    source_keys = set()
    source_identities = Counter()
    source_counts = {}
    source_communities = set()
    source_by_row = {}
    for sheet, rows in xlsx_rows(paths['c9_source']):
        if sheet == 'Address Collection SF Household': continue
        selected = [(number, values) for number, values in rows if number > 4 and clean(values.get('C')) and clean(values.get('D'))]
        source_counts[sheet] = len(selected)
        for number, values in selected:
            source_communities.add(c9_community(values.get('D')))
            source_by_row[(sheet, number)] = values
            unit, civic, street = unit_text(values.get('A')), clean(values.get('B')), clean(values.get('C'))
            # The original Crowsnest sheet places civic in A and splits street across B/C.
            if sheet == 'Bellevue,Blair,Cole,Frank,HC' and unit:
                unit, civic, street = '', unit, street if civic == '123' and street.lower() not in {'st', 'ave', 'street', 'avenue'} else clean(f'{civic} {street}')
            source_keys.add(tuple(clean(value).upper() for value in [values.get('D'), unit, civic, street]))
            if sheet == 'Town of Cardston' and street == 'A Ave W': street = '2A Ave W'
            if sheet == 'Town of Cardston' and number == 1255 and civic == '123': civic = ''
            if sheet == 'Bellevue,Blair,Cole,Frank,HC' and civic == '123' and street.upper() == 'NW 1/4 4 8 4 W 5': civic = ''
            if sheet == 'Hamlet of Tilley' and re.fullmatch(r'RR\s*130A', street, re.I): street = 'Range Road 130A'
            if (sheet, number) != ('Town of Magrath', 661):
                source_identities[tuple(clean(value).upper() for value in [values.get('D'), unit, civic, street])] += 1
    missing_source = []
    reviewed_differences = []
    for row in c9:
        if row['service_community'] in {'Enchant', 'Hays'}: continue
        key = tuple(clean(value).upper() for value in [row['workbook_community'], unit_text(row['unit']), row['street_number'], row['street_name']])
        if key not in source_keys:
            original = source_by_row.get((row['source_sheet'], int(row['source_excel_row'])), {})
            # Preserve these exact corrections already in the reviewed final workbook.
            accepted = (
                row['source_sheet'] == 'Town of Cardston' and clean(original.get('C')) == 'A Ave W' and row['street_name'] == '2A Ave W' and clean(original.get('B')) == row['street_number']
                or row['service_id'] == 'REAL_CARDSTON_005073' and clean(original.get('B')) == '123' and row['street_number'] == '' and clean(original.get('C')) == row['street_name']
                or row['source_sheet'] == 'Bellevue,Blair,Cole,Frank,HC' and clean(original.get('B')) == '123' and row['street_number'] == '' and row['street_name'].upper() == clean(original.get('C')).upper() == 'NW 1/4 4 8 4 W 5'
                or row['source_sheet'] == 'Hamlet of Tilley' and re.fullmatch(r'RR\s*130A', clean(original.get('C')), re.I) and row['street_name'] == 'Range Road 130A' and clean(original.get('B')) == row['street_number']
            )
            detail = {field: row[field] for field in ['service_id', 'source_sheet', 'source_excel_row', 'workbook_community', 'unit', 'street_number', 'street_name']}
            (reviewed_differences if accepted else missing_source).append(detail)
    routed_identities = Counter(tuple(clean(value).upper() for value in [row['workbook_community'], unit_text(row['unit']), row['street_number'], row['street_name']]) for row in c9 if row['service_community'] not in {'Enchant', 'Hays'})
    assert source_identities == routed_identities, f'C9 source coverage differs: {list((source_identities-routed_identities).items())[:5]}; {list((routed_identities-source_identities).items())[:5]}'
    placeholder = source_by_row[('Town of Magrath', 661)]
    assert clean(placeholder.get('B')) == clean(placeholder.get('C')) == '123'

    customer_rows = set()
    customer_communities = set()
    for _, rows in xlsx_rows(paths['wood_buffalo_source']):
        for number, row in rows:
            if number > 1 and any(clean(row.get(column)) for column in ['A', 'B', 'C']):
                customer_rows.add(number)
                customer_communities.add(clean(row.get('E')))
    linked_customer_rows = set()
    for row in wb:
        for ref in json.loads(row['source_references']):
            if ref['source_file'] == 'Customers.xlsx': linked_customer_rows.add(int(ref['source_row']))
    missing_customers = sorted(customer_rows - linked_customer_rows)

    localities = {'FORT MCMURRAY': 'Fort McMurray', 'FORT MCKAY': 'Fort McKay', 'SAPRAE CREEK ESTATES': 'Saprae Creek Estates', 'GREGOIRE LAKE ESTATES': 'Gregoire Lake Estates', 'ANZAC': 'Anzac', 'DRAPER': 'Draper', 'CONKLIN': 'Conklin', 'JANVIER': 'Janvier'}
    entries = []
    provenance = defaultdict(list)
    grouped_communities = defaultdict(set)
    for dataset, rows in [('C9', c9), ('Wood Buffalo', wb)]:
        for row in rows:
            address = clean(row['full_address'])
            unit = unit_text(row['unit'])
            if dataset == 'C9' and unit and not re.search(r'\bUnit\s+' + re.escape(unit) + r'\b', address, re.I):
                address = f'Unit {unit}, {address}'
            communities = [clean(row['service_community'])] if dataset == 'C9' else [localities[row['locality']]]
            if dataset == 'C9':
                # Routing groups such as Crowsnest Pass must not hide the town
                # recorded in the source workbook. Keep the existing group too.
                # Use workbook_community, not routing subarea, for these labels.
                community = c9_community(row['workbook_community'])
                assert community, (row['service_id'], 'Missing workbook community')
                if community not in communities:
                    grouped_communities[communities[0]].add(community)
                    communities.append(community)
            for community in communities:
                entry = {'community': community, 'address': address, 'street': clean(row['street_name'] if dataset == 'C9' else row['street'])}
                assert all(entry.values()), (dataset, row['service_id'], entry)
                identity = (entry['community'].casefold(), entry['address'].casefold())
                provenance[identity].append({'dataset': dataset, 'serviceId': row['service_id']})
                entries.append(entry)
    unique = { (row['community'].casefold(), row['address'].casefold()): row for row in entries }
    output = sorted(unique.values(), key=lambda row: (row['community'].casefold(), row['address'].casefold()))
    # Independently reconcile names from the original workbooks, including the
    # service-address add-ons and approved rural Wood Buffalo route localities.
    c9_expected = source_communities | set(addon_checks)
    wb_source_expected = {localities[name] for name in customer_communities}
    wb_route_expected = {localities[row['locality']] for row in wb}
    expected_communities = c9_expected | wb_source_expected | wb_route_expected
    actual_communities = {row['community'] for row in output}
    missing_communities = sorted(expected_communities - actual_communities)
    report = {
        'sourceSnapshot': '2026-09-24',
        'sources': {name: {'path': path.relative_to(root).as_posix(), 'sha256': before[name]} for name, path in paths.items()},
        'sourceRows': {'C9': len(c9), 'Wood Buffalo': len(wb)},
        'catalogueAddresses': len(output), 'communities': dict(sorted(Counter(row['community'] for row in output).items())),
        'communityCoverage': {
            'c9SourceCommunities': sorted(c9_expected),
            'c9SourceNameNormalizations': C9_COMMUNITY_NAMES,
            'woodBuffaloSourceCommunities': sorted(wb_source_expected),
            'woodBuffaloRouteCommunities': sorted(wb_route_expected),
            'retainedServiceGroups': {name: sorted(values) for name, values in sorted(grouped_communities.items())},
            'missingSourceCommunities': missing_communities,
        },
        'c9SourceRowsBySheet': source_counts, 'c9UnreconciledRows': missing_source,
        'c9ReviewedWorkbookMatchesAllServices': True, 'c9ReviewedAddressCorrections': reviewed_differences,
        'c9ExcludedTemplateRow': {'sheet': 'Town of Magrath', 'row': 661, 'reason': '123 123 placeholder absent from approved final routes'},
        'serviceAddressOnlyAddons': addon_checks,
        'woodBuffaloCustomerSourceRows': len(customer_rows), 'woodBuffaloLinkedSourceRows': len(linked_customer_rows), 'woodBuffaloUnlinkedSourceRows': missing_customers,
        'brooksAdditionsIncluded': len(addition_ids), 'parklandUnitsIncluded': sorted(expected_units),
        'collapsedIdenticalOptions': [{'community': unique[key]['community'], 'address': unique[key]['address'], 'services': values} for key, values in provenance.items() if len(values) > 1],
    }
    assert all(digest(path) == before[name] for name, path in paths.items()), 'A source changed during import.'
    args.output.parent.mkdir(parents=True, exist_ok=True)
    audit_path = args.output.with_name('service-locations-audit.json')
    audit_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps({'sourceRows': report['sourceRows'], 'catalogueAddresses': len(output), 'communities': len(report['communities']), 'c9UnreconciledCount': len(missing_source), 'c9UnreconciledSamples': missing_source[:5], 'woodBuffaloUnlinkedCount': len(missing_customers), 'brooksAdditionsIncluded': len(addition_ids), 'parklandUnitsIncluded': len(expected_units)}, indent=2))
    assert not missing_source, 'Reconcile C9 source differences before importing.'
    assert not missing_customers, 'Reconcile Wood Buffalo source lineages before importing.'
    assert not missing_communities, f'Source communities missing from catalogue: {missing_communities}'
    temporary = args.output.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    temporary.replace(args.output)
    print(f'Saved {len(output)} addresses to {args.output}')


if __name__ == '__main__':
    main()
