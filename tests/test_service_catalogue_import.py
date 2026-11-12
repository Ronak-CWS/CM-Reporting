"""Regression checks for importing reviewed additions without changing old choices."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('catalogue_import', Path(__file__).parents[1] / 'scripts/build-service-catalogue.py')
catalogue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalogue)


class CatalogueAdditionsTests(unittest.TestCase):
    def test_units_keep_their_identity_without_repeating_existing_unit_text(self):
        self.assertEqual(catalogue.catalogue_address('765 28 St', 'Unit 1'), 'Unit 1, 765 28 St')
        self.assertEqual(catalogue.catalogue_address('24 1 St SW', '# 3,'), 'Unit 3, 24 1 St SW')
        self.assertEqual(catalogue.catalogue_address('Parkland Estates - Unit 8B', '8B'), 'Parkland Estates - Unit 8B')
        self.assertEqual(catalogue.catalogue_address('366 Hankel Crt', '#1-6'), 'Unit 1-6, 366 Hankel Crt')

    def test_rejected_rows_cannot_add_locations_and_old_choices_are_retained(self):
        original = [{'community': 'Brooks', 'address': '10 Example St', 'street': 'Example St'}]
        master = [{'Status': 'Rejected', 'Community': 'Brooks', 'Address': '10 Example St', 'Unit': '', 'Record ID': 'rejected-old'},
                  {'Status': 'Rejected', 'Community': 'Brooks', 'Address': '20 Example St', 'Unit': '', 'Record ID': 'rejected-new'}]
        result, additions = catalogue.append_reviewed_addresses(original, master, [])
        self.assertEqual(result, original)
        self.assertEqual(additions, [])

    def test_new_units_are_separate_choices_and_repeated_rows_do_not_duplicate_them(self):
        original = [{'community': 'Raymond', 'address': '133N 400 St W', 'street': '400 St W'}]
        master = [{'Status': 'Active', 'Community': 'Raymond', 'Address': '133N 400 St W', 'Unit': unit, 'Record ID': unit}
                  for unit in ['1', '2', '2']]
        result, additions = catalogue.append_reviewed_addresses(original, master, [])
        self.assertEqual(len(result), 3)
        self.assertEqual([row['address'] for row in additions], ['Unit 1, 133N 400 St W', 'Unit 2, 133N 400 St W'])
        self.assertTrue(all(row['street'] == '400 St W' for row in result))

    def test_new_crowsnest_aliases_do_not_reassign_existing_workbook_towns(self):
        original = [{'community': community, 'address': '14649 16 Ave', 'street': '16 Ave'}
                    for community in ['Crowsnest Pass', 'Blairmore']]
        master = [{'Status': 'Active', 'Community': 'Crowsnest Pass', 'Address': '14649 16 Ave', 'Unit': '', 'Area': 'Frank', 'Record ID': 'existing'},
                  {'Status': 'Active', 'Community': 'Crowsnest Pass', 'Address': '1405 84 St', 'Unit': '', 'Area': 'Coleman', 'Record ID': 'new'}]
        result, additions = catalogue.append_reviewed_addresses(original, master, [])
        self.assertEqual(len(result), 4)
        self.assertNotIn('Frank', {row['community'] for row in result})
        self.assertEqual([row['community'] for row in additions], ['Crowsnest Pass', 'Coleman'])

    def test_unlocated_supplied_addresses_are_not_replaced_by_geocoding_candidates(self):
        source = [{'community': 'Brooks', 'address': '37 Meadow Lake Gate E', 'street': 'Meadow Lake Gate E',
                   'status': 'Request Fulfilled', 'rpc': 'RPC11926608'}]
        result, additions = catalogue.append_reviewed_addresses([], [], source)
        self.assertEqual(result[0]['address'], '37 Meadow Lake Gate E')
        self.assertEqual(additions[0]['recordId'], 'RPC11926608')


if __name__ == '__main__':
    unittest.main()
