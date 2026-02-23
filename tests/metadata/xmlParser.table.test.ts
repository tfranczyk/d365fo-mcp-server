import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { XppMetadataParser } from '../../src/metadata/xmlParser.js';

describe('XppMetadataParser parseTableFile', () => {
  it('parses nested index fields and relation constraints from AxTable XML', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xml-parser-table-'));
    const xmlPath = path.join(tempDir, 'TestTable.xml');

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<AxTable xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
  <Name>TestTable</Name>
  <Label>@Test:TestTableLabel</Label>
  <TableGroup>Main</TableGroup>
  <PrimaryIndex>MyPrimaryIdx</PrimaryIndex>
  <ClusteredIndex>MyPrimaryIdx</ClusteredIndex>
  <Fields>
    <AxTableField xmlns="" i:type="AxTableFieldString">
      <Name>Id</Name>
      <Type>String</Type>
      <Mandatory>Yes</Mandatory>
    </AxTableField>
  </Fields>
  <Indexes>
    <AxTableIndex>
      <Name>MyPrimaryIdx</Name>
      <Fields>
        <AxTableIndexField>
          <DataField>Id</DataField>
        </AxTableIndexField>
      </Fields>
    </AxTableIndex>
  </Indexes>
  <Relations>
    <AxTableRelation xmlns="" i:type="AxTableRelationForeignKey">
      <Name>RelatedTableRel</Name>
      <RelatedTable>OtherTable</RelatedTable>
      <Constraints>
        <AxTableRelationConstraint xmlns="" i:type="AxTableRelationConstraintField">
          <Field>Id</Field>
          <RelatedField>OtherId</RelatedField>
        </AxTableRelationConstraint>
      </Constraints>
    </AxTableRelation>
  </Relations>
</AxTable>`;

    await fs.writeFile(xmlPath, xml, 'utf-8');

    const parser = new XppMetadataParser();
    const result = await parser.parseTableFile(xmlPath, 'TestModel');

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.name).toBe('TestTable');

    expect(result.data?.indexes.length).toBe(1);
    expect(result.data?.indexes[0].name).toBe('MyPrimaryIdx');
    expect(result.data?.indexes[0].fields).toEqual(['Id']);

    expect(result.data?.relations.length).toBe(1);
    expect(result.data?.relations[0].name).toBe('RelatedTableRel');
    expect(result.data?.relations[0].constraints).toEqual([
      { field: 'Id', relatedField: 'OtherId' },
    ]);
  });
});
