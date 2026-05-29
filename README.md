# File Genie

File Genie is a Cribl App Platform app for managing lookup files across your Cribl deployment. It gives you a single place to see where your lookup files live, detect drift between scopes, compare content, and push updates to any group or fleet.

## What It Does

Lookup files are often deployed to multiple Worker Groups, Fleets, or Packs. Over time these copies can drift — different content, different metadata, or a file that only exists in one place. File Genie scans all your scopes, surfaces sync status at a glance, and lets you fix problems without leaving the UI.

---

## Views

### Inventory

The home screen. It lists every unique lookup file found across all your scopes.

| Column | Description |
|---|---|
| **Name** | Lookup filename. Click to open the Comparison view. |
| **Found In** | Chips showing which Worker Groups / Fleets hold a copy. |
| **Size** | File size (hidden by default — enable via Columns picker). |
| **Last Modified** | Most-recent modification timestamp across all copies. |
| **Status** | Worst-case sync status across all copies (see [Statuses](#sync-statuses)). |

**Toolbar controls:**

- **Search** — filter by filename.
- **Status** dropdown — show only files with a particular sync status.
- **Scope** dropdown — show only files present in a specific group or fleet.
- **Packs: On/Off** — toggle whether Pack lookups appear as separate rows.
- **Hide Sole Copy** — hide files that exist in only one scope (not a drift problem, just not distributed yet).
- **Columns** — show or hide optional columns.
- **Use Cache** — reload from the last saved scan without hitting the API again.
- **Refresh Scan** — re-scan all scopes live and update the inventory.

An alert banner appears at the top when any files are out of sync or are sole copies, with a quick link to the Drift Dashboard.

---

### Drift Dashboard

A health summary across your entire deployment. Stat cards show counts for each category; clicking a card filters the table below it.

| Card | Meaning |
|---|---|
| **Total Lookups** | Unique lookup names found across all scopes. |
| **In Sync** | Files with identical content and metadata everywhere they appear. |
| **Out of Sync** | Files with content or metadata differences between scopes. |
| **Sole Copy** | Files that exist in only one scope — not drifted, but not distributed. |
| **Missing Copies** | Files absent from at least one scope that has other copies of it. |
| **Content Diffs** | Files where the actual file content differs between scopes. |
| **Meta Only Diffs** | Files with matching content but differing metadata (size, modified date, etc.). |

Each row links to the **Comparison** view for that file. Rows with `out_of_sync` status are highlighted in amber.

---

### Comparison View

Opened by clicking a filename in the Inventory or Drift table. Shows everything about a single lookup file:

**Scope presence grid**
Cards for each scope that holds a copy (or is missing one). Each card shows the scope type (group / fleet / pack), size, last-modified date, the author, and a short content hash. Missing scopes appear as greyed-out cards.

**Sync from source**
Pick any scope card as the *Source of Truth*, then click **Sync from \<scope\>** to copy that version to all other scopes. A modal lets you review and confirm targets before any write happens.

**Metadata comparison**
A table comparing size, modified date, and other metadata field-by-field across all copies. Rows with differences are highlighted.

**Content diff**
Select two scopes from the dropdowns, click **Load Diff**, and see a side-by-side diff of the raw file content.

The **Edit & Push** button in the header takes you straight to the Edit view for this file.

---

### Edit & Push

A guided multi-step workflow for editing a lookup file and pushing it to your groups.

1. **Choose source** — pick which scope's copy to load as your starting point (or start with a blank file).
2. **Edit** — modify the file content in the inline table editor. A `●` indicator appears in the title when you have unsaved changes.
3. **Select targets** — choose which Worker Groups / Fleets to push the edited version to. Options:
   - *Skip targets that already match* — compares by hash and skips scopes where the content is already identical.
   - *Dry run* — previews what would happen without writing any changes.
4. **Confirm** — review a summary of every scope that will be written (or created).
5. **Results** — shows per-scope success / skipped / failure after the push completes.

---

## Sync Statuses

| Badge | Meaning |
|---|---|
| **In Sync** | This copy matches all other copies (content and metadata). |
| **Out of Sync** | Content or metadata differs from at least one other copy. |
| **Sole Copy** | Only one copy exists — nothing to compare against. |
| **Missing** | This scope should have the file but it is absent. |
| **Unknown** | Status could not be determined (content not yet fetched). |

Status on inventory rows uses a *worst-wins* rule: if a file is `out_of_sync` on any scope it shows as `out_of_sync` in the inventory regardless of other copies.

---

## Scopes

File Genie recognises three scope types:

| Type | Description |
|---|---|
| **Worker Group** | A Cribl Stream worker group. |
| **Fleet** | A Cribl Edge fleet. |
| **Pack** | A content pack installed on a worker group. Pack lookups are hidden by default in the inventory and can be toggled on with the Packs button. |
