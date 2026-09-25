-- Documents: the paper an entry rests on.
--
-- An auditor does not take a ledger's word for it. Every purchase is asked
-- for its supplier invoice, every import for its customs declaration and bill
-- of lading, every refund for the credit note behind it. Until now those
-- lived in an email thread or a shared drive, found again — if at all — by
-- somebody remembering which folder the container number was filed under.
--
-- A document is stored once per tenant, identified by what it contains, and
-- linked to what it supports: an entry, or a shipment. The bytes and their
-- fingerprint are checked against each other by the database, the content is
-- never changed, and a link that was a mistake is marked removed rather than
-- deleted, so the history of what an entry was supported by survives.
--
-- See docs/adr/0024-documents.md.

CREATE TABLE documents (
  id           text PRIMARY KEY,
  org_id       text NOT NULL,
  -- Hex SHA-256 of the content. The same file uploaded twice is one document.
  sha256       char(64) NOT NULL,
  -- As the person named it, cleaned of any path. Shown and offered on download.
  filename     text NOT NULL,
  -- Decided from the bytes, never from what the browser claimed.
  content_type text NOT NULL,
  size_bytes   integer NOT NULL,
  content      bytea NOT NULL,
  uploaded_by  text,
  created_at   timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE documents ADD CONSTRAINT documents_org_fk
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE documents ADD CONSTRAINT documents_id_org_key UNIQUE (id, org_id);

--> statement-breakpoint
CREATE UNIQUE INDEX documents_org_sha256_key ON documents (org_id, sha256);

--> statement-breakpoint
-- The fingerprint is the content's, and the size is the content's. Checked
-- here rather than trusted from the writer: a document whose hash does not
-- match its bytes is one whose deduplication and whose evidence are both lies.
ALTER TABLE documents ADD CONSTRAINT documents_content_check CHECK (
  size_bytes BETWEEN 1 AND 4194304
  AND octet_length(content) = size_bytes
  AND sha256 = encode(sha256(content), 'hex')
  AND length(filename) BETWEEN 1 AND 200
  AND content_type IN (
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/xml'
  )
);

--> statement-breakpoint
CREATE TRIGGER documents_append_only
  BEFORE UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION obol_reject_mutation();

--> statement-breakpoint
CREATE TABLE document_links (
  id             text PRIMARY KEY,
  org_id         text NOT NULL,
  document_id    text NOT NULL,
  -- Exactly one of these: what the document supports.
  transaction_id text,
  shipment_id    text,
  kind           text NOT NULL,
  note           text,
  linked_by      text,
  created_at     timestamp with time zone DEFAULT now() NOT NULL,
  -- A link attached in error is taken off, not erased.
  removed_at     timestamp with time zone,
  removed_by     text
);

--> statement-breakpoint
ALTER TABLE document_links ADD CONSTRAINT document_links_document_fk
  FOREIGN KEY (document_id, org_id) REFERENCES documents (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE document_links ADD CONSTRAINT document_links_transaction_fk
  FOREIGN KEY (transaction_id, org_id) REFERENCES transactions (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE document_links ADD CONSTRAINT document_links_shipment_fk
  FOREIGN KEY (shipment_id, org_id) REFERENCES shipments (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE document_links ADD CONSTRAINT document_links_shape_check CHECK (
  num_nonnulls(transaction_id, shipment_id) = 1
  AND kind IN (
    'invoice', 'receipt', 'customs_declaration', 'bill_of_lading',
    'delivery_note', 'contract', 'other'
  )
  AND (note IS NULL OR length(note) <= 280)
  AND (removed_at IS NOT NULL OR removed_by IS NULL)
);

--> statement-breakpoint
-- One live link per document per thing it supports.
CREATE UNIQUE INDEX document_links_transaction_key
  ON document_links (document_id, transaction_id)
  WHERE transaction_id IS NOT NULL AND removed_at IS NULL;

--> statement-breakpoint
CREATE UNIQUE INDEX document_links_shipment_key
  ON document_links (document_id, shipment_id)
  WHERE shipment_id IS NOT NULL AND removed_at IS NULL;

--> statement-breakpoint
CREATE INDEX document_links_org_transaction_idx
  ON document_links (org_id, transaction_id) WHERE transaction_id IS NOT NULL;

--> statement-breakpoint
CREATE INDEX document_links_org_shipment_idx
  ON document_links (org_id, shipment_id) WHERE shipment_id IS NOT NULL;

--> statement-breakpoint
-- A link can be taken off once, and nothing else about it can change.
CREATE OR REPLACE FUNCTION obol_document_link_removal_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'document links are append-only; mark one removed instead'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.removed_at IS NOT NULL
     OR NEW.removed_at IS NULL
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.transaction_id IS DISTINCT FROM OLD.transaction_id
     OR NEW.shipment_id IS DISTINCT FROM OLD.shipment_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.linked_by IS DISTINCT FROM OLD.linked_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'document links are append-only; the only change allowed is removing one'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER document_links_removal_only
  BEFORE UPDATE OR DELETE ON document_links
  FOR EACH ROW EXECUTE FUNCTION obol_document_link_removal_only();

--> statement-breakpoint
ALTER TABLE documents      ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE documents      FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE document_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE document_links FORCE  ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE POLICY documents_tenant_isolation ON documents
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

--> statement-breakpoint
CREATE POLICY document_links_tenant_isolation ON document_links
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
