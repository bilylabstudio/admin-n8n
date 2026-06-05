# Shopify Orders Backfill 2026 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a temporary n8n workflow that imports every Shopify order from `2026-01-01T00:00:00.000Z` onward in bounded 250-order pages, without duplicating existing `PlatformOrder` rows.

**Architecture:** Create a separate n8n workflow JSON based on `workflows/shopify-finanzas-sync.json`. The workflow uses a Manual Trigger, reads the same admin settings and Shopify credential, reads/writes an isolated cursor under platform `shopify_backfill_2026`, loops with `sinceId`, posts each non-empty batch to `POST /api/n8n/orders`, persists page progress through `POST /api/n8n/sync-state`, caps each manual execution at 10 Shopify pages, and ends with one summary item.

**Tech Stack:** n8n workflow JSON, Shopify n8n node, DataTable node, HTTP Request node, Code node JavaScript, Review Admin `/api/n8n/orders`.

**Runtime correction:** Large manual executions still accumulate live editor/canvas data in n8n even when execution saving is disabled. The workflow must therefore stop after `max_pages_per_run: 10` pages, show `Resumen final.has_more_pages`, and rely on the persisted `shopify_backfill_2026` cursor so the next manual run continues from the last saved Shopify ID instead of starting from zero.

---

## File Structure

- Create: `../workflows/shopify-finanzas-backfill-2026-temporal.json`
  - Temporary n8n workflow export for import/testing in n8n.
  - Must not modify `../workflows/shopify-finanzas-sync.json`.
  - Must avoid `raw_json` in the backfill payload to prevent large manual execution data from crashing n8n.
  - Must set `saveManualExecutions: false`, `saveExecutionProgress: false`, `saveDataSuccessExecution: none`, and `saveDataErrorExecution: none`.
  - Must set `max_pages_per_run: 10` and stop cleanly after each chunk so the n8n editor does not accumulate hundreds of loop iterations in one manual execution.
- Reference: `../workflows/shopify-finanzas-sync.json`
  - Source for DataTable ID, Shopify credential ID/name, field list, retry settings, and admin POST pattern.
- Reference: `src/lib/platform-orders.ts`
  - Confirms `POST /api/n8n/orders` is idempotent through `upsertPlatformOrders`.
- Reference: `docs/superpowers/specs/2026-06-05-shopify-orders-backfill-2026-design.md`
  - Approved design and acceptance criteria.

---

### Task 1: Create The Temporary Workflow Skeleton

**Files:**
- Create: `../workflows/shopify-finanzas-backfill-2026-temporal.json`
- Reference: `../workflows/shopify-finanzas-sync.json`

- [ ] **Step 1: Create the workflow JSON with trigger, settings read, and state initialization**

Create `../workflows/shopify-finanzas-backfill-2026-temporal.json` with this skeleton:

```json
{
  "name": "Shopify - Finanzas Backfill Temporal 2026",
  "nodes": [
    {
      "id": "trigger-manual-backfill-2026",
      "name": "Trigger manual backfill 2026",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [-1320, -40],
      "parameters": {}
    },
    {
      "id": "read-admin-settings",
      "name": "Leer configuracion admin",
      "type": "n8n-nodes-base.dataTable",
      "typeVersion": 1.1,
      "position": [-1080, -40],
      "parameters": {
        "operation": "get",
        "dataTableId": { "mode": "id", "value": "Y8KDGv2Ua1UCfz4D" },
        "returnAll": true
      }
    },
    {
      "id": "flatten-settings",
      "name": "Aplanar settings",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [-840, -40],
      "parameters": {
        "mode": "runOnceForAllItems",
        "language": "javaScript",
        "jsCode": "const rows = $input.all().map((i) => i.json);\\nconst settings = Object.fromEntries(rows.map((r) => [String(r.key || '').trim(), String(r.value || '').trim()]));\\nconst base = (settings.review_admin_base_url || settings.REVIEW_ADMIN_BASE_URL || '').replace(/\\\\/+$/, '');\\nconst secret = settings.review_admin_ingest_secret || settings.ingest_secret || '';\\nreturn [{\\n  json: {\\n    review_admin_base_url: base,\\n    review_admin_ingest_secret: secret,\\n    review_admin_orders_url: base ? `${base}/api/n8n/orders` : ''\\n  }\\n}];"
      }
    },
    {
      "id": "initialize-backfill-state",
      "name": "Inicializar estado backfill",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [-600, -40],
      "parameters": {
        "mode": "runOnceForAllItems",
        "language": "javaScript",
        "jsCode": "const input = $input.first().json;\\nconst state = $getWorkflowStaticData('global');\\nstate.backfill2026 = {\\n  started_at: new Date().toISOString(),\\n  created_at_min: '2026-01-01T00:00:00.000Z',\\n  since_id: '0',\\n  page: 1,\\n  pages_processed: 0,\\n  total_imported: 0,\\n  last_since_id: '0',\\n  last_batch_count: 0,\\n  review_admin_orders_url: input.review_admin_orders_url,\\n  review_admin_ingest_secret: input.review_admin_ingest_secret\\n};\\nif (!state.backfill2026.review_admin_orders_url) {\\n  throw new Error('Missing review_admin_orders_url from admin settings');\\n}\\nif (!state.backfill2026.review_admin_ingest_secret) {\\n  throw new Error('Missing review_admin_ingest_secret from admin settings');\\n}\\nreturn [{ json: { ...state.backfill2026 } }];"
      }
    }
  ],
  "connections": {
    "Trigger manual backfill 2026": {
      "main": [[{ "node": "Leer configuracion admin", "type": "main", "index": 0 }]]
    },
    "Leer configuracion admin": {
      "main": [[{ "node": "Aplanar settings", "type": "main", "index": 0 }]]
    },
    "Aplanar settings": {
      "main": [[{ "node": "Inicializar estado backfill", "type": "main", "index": 0 }]]
    }
  },
  "settings": {
    "executionOrder": "v1",
    "timezone": "Europe/Madrid",
    "saveDataErrorExecution": "all",
    "saveDataSuccessExecution": "all"
  },
  "staticData": null,
  "pinData": {},
  "active": false
}
```

- [ ] **Step 2: Validate JSON parses**

Run from repository root:

```powershell
node -e "JSON.parse(require('fs').readFileSync('workflows/shopify-finanzas-backfill-2026-temporal.json','utf8')); console.log('workflow json ok')"
```

Expected output:

```text
workflow json ok
```

- [ ] **Step 3: Record skeleton status**

If the workflow file is inside an active Git repository in the implementation environment, commit it:

```powershell
git add workflows/shopify-finanzas-backfill-2026-temporal.json
git commit -m "feat: add shopify orders backfill workflow skeleton"
```

If the root workflow folder is outside Git, do not commit from `review-admin`; report that the workflow export was created locally and will be imported into n8n.

---

### Task 2: Add Shopify Pagination And Batch Mapping

**Files:**
- Modify: `../workflows/shopify-finanzas-backfill-2026-temporal.json`
- Reference: `../workflows/shopify-finanzas-sync.json`

- [ ] **Step 1: Add the page preparation node**

Add this node after `Inicializar estado backfill`:

```json
{
  "id": "prepare-shopify-page",
  "name": "Preparar pagina Shopify",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [-360, -40],
  "parameters": {
    "mode": "runOnceForAllItems",
    "language": "javaScript",
    "jsCode": "const state = $getWorkflowStaticData('global').backfill2026;\\nif (!state) throw new Error('Backfill state was not initialized');\\nreturn [{\\n  json: {\\n    created_at_min: state.created_at_min,\\n    since_id: state.since_id,\\n    page: state.page\\n  }\\n}];"
  }
}
```

- [ ] **Step 2: Add the Shopify order fetch node**

Add this node after `Preparar pagina Shopify`, copying the credential from `workflows/shopify-finanzas-sync.json`:

```json
{
  "id": "shopify-fetch-orders-page",
  "name": "Shopify - obtener pagina 250",
  "type": "n8n-nodes-base.shopify",
  "typeVersion": 1,
  "position": [-120, -40],
  "parameters": {
    "authentication": "oAuth2",
    "resource": "order",
    "operation": "getAll",
    "returnAll": false,
    "limit": 250,
    "options": {
      "fields": "id,name,currency,processed_at,created_at,updated_at,financial_status,fulfillment_status,cancelled_at,test,subtotal_price,total_tax,total_shipping_price_set,total_discounts,total_price,refunds,line_items,email,contact_email,shipping_address,billing_address,source_name"
    },
    "filters": {
      "status": "any",
      "sinceId": "={{ $json.since_id }}",
      "createdAtMin": "={{ $json.created_at_min }}"
    }
  },
  "credentials": {
    "shopifyOAuth2Api": {
      "id": "8TnWlcUV4oYH6N4o",
      "name": "Shopify account 2"
    }
  },
  "alwaysOutputData": true,
  "retryOnFail": true,
  "maxTries": 5,
  "waitBetweenTries": 15000
}
```

- [ ] **Step 3: Add the batch builder node**

Add this node after Shopify. This replaces the original one-item mapper and the separate batch summarizer so empty pages are handled safely.

```json
{
  "id": "build-batch-and-advance-cursor",
  "name": "Construir batch y avanzar cursor",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [120, -40],
  "parameters": {
    "mode": "runOnceForAllItems",
    "language": "javaScript",
    "jsCode": "const stateRoot = $getWorkflowStaticData('global');\\nconst state = stateRoot.backfill2026;\\nif (!state) throw new Error('Backfill state was not initialized');\\n\\nconst rawOrders = $input.all().map((i) => i.json).filter((order) => order && order.id);\\nconst toUtc = (v) => v ? new Date(v).toISOString() : null;\\nconst orders = rawOrders.map((order) => {\\n  const totalUnits = (order.line_items || []).reduce((s, li) => s + (li.quantity || 0), 0);\\n  const totalRefunded = (order.refunds || [])\\n    .flatMap((r) => r.transactions || [])\\n    .filter((t) => t.kind === 'refund' && t.status === 'success')\\n    .reduce((s, t) => s + parseFloat(t.amount || 0), 0);\\n\\n  return {\\n    platform: 'shopify',\\n    external_order_id: String(order.id),\\n    order_number: order.name || null,\\n    currency: order.currency || 'EUR',\\n    processed_at: toUtc(order.processed_at || order.created_at),\\n    financial_status: order.financial_status || 'pending',\\n    fulfillment_status: order.fulfillment_status || null,\\n    cancelled_at: toUtc(order.cancelled_at),\\n    is_test: !!order.test,\\n    subtotal: String(order.subtotal_price || 0),\\n    total_tax: String(order.total_tax || 0),\\n    total_shipping: String(order.total_shipping_price_set?.shop_money?.amount || 0),\\n    total_discounts: String(order.total_discounts || 0),\\n    total_price: String(order.total_price || 0),\\n    total_refunded: String(totalRefunded),\\n    total_units: totalUnits,\\n    customer_email: order.email || order.contact_email || null,\\n    country_code: order.shipping_address?.country_code || order.billing_address?.country_code || null,\\n    channel: order.source_name || null,\\n    raw_json: order,\\n    external_updated_at: toUtc(order.updated_at)\\n  };\\n});\\n\\nlet maxId = state.since_id || '0';\\nfor (const order of orders) {\\n  const idStr = String(order.external_order_id || '');\\n  if (idStr && BigInt(idStr) > BigInt(maxId)) maxId = idStr;\\n}\\n\\nstate.pages_processed += 1;\\nstate.last_batch_count = orders.length;\\nif (orders.length) {\\n  state.total_imported += orders.length;\\n  state.last_since_id = maxId;\\n  state.since_id = maxId;\\n  state.page += 1;\\n}\\n\\nreturn [{\\n  json: {\\n    orders,\\n    batch_count: orders.length,\\n    should_post: orders.length > 0,\\n    should_continue: orders.length === 250,\\n    created_at_min: state.created_at_min,\\n    since_id: state.since_id,\\n    page: state.page,\\n    pages_processed: state.pages_processed,\\n    total_imported: state.total_imported,\\n    last_since_id: state.last_since_id\\n  }\\n}];"
  }
}
```

- [ ] **Step 4: Wire nodes**

Update `connections` so the flow is:

```json
"Inicializar estado backfill": {
  "main": [[{ "node": "Preparar pagina Shopify", "type": "main", "index": 0 }]]
},
"Preparar pagina Shopify": {
  "main": [[{ "node": "Shopify - obtener pagina 250", "type": "main", "index": 0 }]]
},
"Shopify - obtener pagina 250": {
  "main": [[{ "node": "Construir batch y avanzar cursor", "type": "main", "index": 0 }]]
}
```

- [ ] **Step 5: Validate JSON parses**

Run:

```powershell
node -e "JSON.parse(require('fs').readFileSync('workflows/shopify-finanzas-backfill-2026-temporal.json','utf8')); console.log('workflow json ok')"
```

Expected output:

```text
workflow json ok
```

---

### Task 3: Add Posting, Loop Control, And Final Summary

**Files:**
- Modify: `../workflows/shopify-finanzas-backfill-2026-temporal.json`

- [ ] **Step 1: Add IF node to skip empty batches**

Add:

```json
{
  "id": "if-has-orders",
  "name": "Hay pedidos en lote",
  "type": "n8n-nodes-base.if",
  "typeVersion": 2.2,
  "position": [360, -40],
  "parameters": {
    "conditions": {
      "options": {
        "caseSensitive": true,
        "leftValue": "",
        "typeValidation": "strict"
      },
      "conditions": [
        {
          "id": "batch-count-positive",
          "leftValue": "={{ $json.batch_count }}",
          "rightValue": 0,
          "operator": { "type": "number", "operation": "gt" }
        }
      ],
      "combinator": "and"
    }
  }
}
```

- [ ] **Step 2: Add POST node**

Add:

```json
{
  "id": "post-orders-to-admin",
  "name": "POST /api/n8n/orders",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [600, -140],
  "parameters": {
    "method": "POST",
    "url": "={{ $getWorkflowStaticData('global').backfill2026.review_admin_orders_url }}",
    "sendHeaders": true,
    "headerParameters": {
      "parameters": [
        { "name": "Content-Type", "value": "application/json" },
        { "name": "X-N8N-Ingest-Token", "value": "={{ $getWorkflowStaticData('global').backfill2026.review_admin_ingest_secret }}" }
      ]
    },
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify({ orders: $json.orders }) }}",
    "options": { "response": { "response": { "responseFormat": "json" } } }
  },
  "retryOnFail": true,
  "maxTries": 2,
  "waitBetweenTries": 3000
}
```

- [ ] **Step 3: Add IF node for pagination continuation**

Add:

```json
{
  "id": "if-more-pages",
  "name": "Hay mas paginas",
  "type": "n8n-nodes-base.if",
  "typeVersion": 2.2,
  "position": [840, -140],
  "parameters": {
    "conditions": {
      "options": {
        "caseSensitive": true,
        "leftValue": "",
        "typeValidation": "strict"
      },
      "conditions": [
        {
          "id": "full-shopify-page",
          "leftValue": "={{ $getWorkflowStaticData('global').backfill2026.last_batch_count }}",
          "rightValue": 250,
          "operator": { "type": "number", "operation": "equals" }
        }
      ],
      "combinator": "and"
    }
  }
}
```

- [ ] **Step 4: Add final summary node**

Do not add an n8n Wait node in this manual backfill. Manual executions can crash or remain paused on Wait during this loop, so the `Hay mas paginas` true branch must connect directly back to `Preparar pagina Shopify`.

Add:

```json
{
  "id": "final-summary",
  "name": "Resumen final",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [1080, 80],
  "parameters": {
    "mode": "runOnceForAllItems",
    "language": "javaScript",
    "jsCode": "const state = $getWorkflowStaticData('global').backfill2026;\\nif (!state) throw new Error('Backfill state was not initialized');\\nreturn [{\\n  json: {\\n    ok: true,\\n    started_at: state.started_at,\\n    finished_at: new Date().toISOString(),\\n    created_at_min: state.created_at_min,\\n    pages_processed: state.pages_processed,\\n    total_imported: state.total_imported,\\n    last_since_id: state.last_since_id,\\n    last_batch_count: state.last_batch_count\\n  }\\n}];"
  }
}
```

- [ ] **Step 5: Wire post, loop, and summary paths**

Update `connections` so:

```json
"Construir batch y avanzar cursor": {
  "main": [[{ "node": "Hay pedidos en lote", "type": "main", "index": 0 }]]
},
"Hay pedidos en lote": {
  "main": [
    [{ "node": "POST /api/n8n/orders", "type": "main", "index": 0 }],
    [{ "node": "Resumen final", "type": "main", "index": 0 }]
  ]
},
"POST /api/n8n/orders": {
  "main": [[{ "node": "Hay mas paginas", "type": "main", "index": 0 }]]
},
"Hay mas paginas": {
  "main": [
    [{ "node": "Preparar pagina Shopify", "type": "main", "index": 0 }],
    [{ "node": "Resumen final", "type": "main", "index": 0 }]
  ]
}
```

The workflow must not contain this connection:

```json
"Pausa entre paginas": {
  "main": [[{ "node": "Preparar pagina Shopify", "type": "main", "index": 0 }]]
}
```

- [ ] **Step 6: Validate JSON parses**

Before validating, add `GET cursor backfill` after `Aplanar settings`, and add `POST /api/n8n/sync-state (backfill)` after `POST /api/n8n/orders`. The cursor platform must be `shopify_backfill_2026`, not `shopify`, so the daily sync cursor remains untouched. The order mapper must omit `raw_json` from the order payload.

Run:

```powershell
node -e "const wf=JSON.parse(require('fs').readFileSync('workflows/shopify-finanzas-backfill-2026-temporal.json','utf8')); console.log(wf.name, wf.nodes.length)"
```

Expected output:

```text
Shopify - Finanzas Backfill Temporal 2026 12
```

---

### Task 4: Validate Against n8n And Prepare Import

**Files:**
- Modify if validation requires fixes: `../workflows/shopify-finanzas-backfill-2026-temporal.json`

- [ ] **Step 1: Discover n8n MCP workflow tools**

Use tool discovery with query:

```text
n8n workflow validate create update node
```

Expected: tools for node search/validation and workflow validation or creation become available.

- [ ] **Step 2: Validate node types and workflow shape**

Use the n8n MCP validation tools if available:

```text
Validate workflow file workflows/shopify-finanzas-backfill-2026-temporal.json.
```

Expected: no invalid node type, credential type, required parameter, or connection errors. If validation reports a node schema mismatch, edit the JSON with the exact field names returned by validation and rerun validation.

- [ ] **Step 3: Confirm the workflow updates only the isolated backfill sync-state**

Run:

```powershell
Select-String -Path workflows\shopify-finanzas-backfill-2026-temporal.json -Pattern "sync-state|sync-cursor"
```

Expected: matches for `/api/n8n/sync-state`, `/api/n8n/sync-cursor`, and platform `shopify_backfill_2026`. It must not write the normal daily sync cursor platform `shopify`.

- [ ] **Step 4: Confirm the workflow uses the approved date and limit**

Run:

```powershell
Select-String -Path workflows\shopify-finanzas-backfill-2026-temporal.json -Pattern "2026-01-01T00:00:00.000Z|limit.: 250|limit`\": 250"
```

Expected: matches for the 2026 start date and Shopify limit `250`.

- [ ] **Step 5: Commit workflow file if it is in a Git repository**

If `workflows/shopify-finanzas-backfill-2026-temporal.json` is tracked by a Git repository in the implementation environment:

```powershell
git add workflows/shopify-finanzas-backfill-2026-temporal.json
git commit -m "feat: add shopify orders backfill workflow"
```

If the root workflow folder is outside Git, do not force a commit from `review-admin`; report that the workflow export was created locally.

---

### Task 5: Import Or Create The Workflow In n8n

**Files:**
- Read: `../workflows/shopify-finanzas-backfill-2026-temporal.json`

- [ ] **Step 1: Check n8n credentials availability**

Use the n8n MCP connection tools or local launcher environment to verify `N8N_URL` and `N8N_API_KEY` are configured.

Expected result:

```text
n8n API reachable
```

If credentials are missing, stop and report:

```text
No pude importar el workflow porque faltan N8N_URL/N8N_API_KEY. El JSON queda listo para importarlo manualmente.
```

- [ ] **Step 2: Create workflow as inactive**

Use n8n MCP workflow creation with the JSON from:

```text
workflows/shopify-finanzas-backfill-2026-temporal.json
```

Required creation settings:

```text
active: false
name: Shopify - Finanzas Backfill Temporal 2026
```

Expected: n8n returns a workflow ID and the workflow remains inactive.

- [ ] **Step 3: Do not execute automatically**

Do not run the workflow after import unless the user explicitly approves a live backfill run. Report:

```text
Workflow creado/importado como inactivo. Queda listo para ejecutar manualmente una vez desde n8n.
```

---

### Task 6: Final Verification And Handoff

**Files:**
- Read: `../workflows/shopify-finanzas-backfill-2026-temporal.json`
- Read: `docs/superpowers/specs/2026-06-05-shopify-orders-backfill-2026-design.md`

- [ ] **Step 1: Verify acceptance criteria manually**

Check:

```text
Workflow separado del diario: yes
Manual Trigger only: yes
Shopify limit 250: yes
created_at_min 2026-01-01: yes
Loop continues only when last batch count is 250 and pages_processed is below max_pages_per_run: yes
max_pages_per_run 10: yes
POST /api/n8n/orders used: yes
POST /api/n8n/sync-state used only for shopify_backfill_2026: yes
Final summary node present: yes
Final summary includes has_more_pages and next_action: yes
Workflow active false: yes
```

- [ ] **Step 2: Show the user exact run instructions**

Final handoff must include:

```text
1. Abrir n8n.
2. Abrir "Shopify - Finanzas Backfill Temporal 2026".
3. Ejecutar manualmente una vez por chunk.
4. Revisar el nodo "Resumen final".
5. Si `has_more_pages` es `true`, ejecutar manualmente otra vez; continuará desde el cursor guardado.
6. Cuando `has_more_pages` sea `false`, desactivar o borrar el workflow temporal.
```

- [ ] **Step 3: Mention duplicate safety**

Final response must include:

```text
No duplica pedidos porque el endpoint de Review Admin usa upsert por platform + externalOrderId.
```
