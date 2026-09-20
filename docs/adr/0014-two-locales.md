# 14. There are two languages, and they are not the same one

- **Status**: Accepted
- **Date**: 2026-09-20

## Context

The demo tenant is a Vietnamese stone exporter, and until now its data read
like this:

```
Đá lát granite 600×600 — granite pavers
Nhập kho thành phẩm — finished goods to store
Cost of goods sold: Đá lát granite 600×600 — granite pavers
```

The intent was kind: an English-speaking reader could follow along. The result
is a product name that is not a name in either language, and a description that
is a sentence in neither. No accountant would write it, no report could print
it, and no search would find it — a Vietnamese user searching _thành phẩm_
matches, and so does an English user searching _finished goods_, which sounds
like a feature until you notice that neither of them can type the name of the
thing they are looking at.

The reason the em dash seemed necessary is that two different questions had
been collapsed into one.

## Decision

**A viewer's language and a tenant's language are separate, and stored
separately.**

|                   | Viewer's language        | Tenant's language                                         |
| ----------------- | ------------------------ | --------------------------------------------------------- |
| What it decides   | The words on the buttons | The words the ledger writes into the books                |
| Where it lives    | A cookie                 | `organizations.locale`                                    |
| Who it belongs to | A person                 | A set of accounting records                               |
| Changing it       | Changes nothing stored   | Would rewrite history, so it does not apply retroactively |

A Vietnamese company keeps its books in Vietnamese. Account 632 is _Giá vốn
hàng bán_ because Thông tư 200 says so, the closing entry is a _bút toán kết
chuyển_, and a shipment's cost of sales is recorded as _Giá vốn hàng bán: Đá
lát granite 600×600_. Their Australian customer's auditor, reading the same
ledger, gets English column headings, English buttons and English help text
over exactly those records — which is what every accounting package in the
world does, and what none of them do is rename the client's accounts.

So the rule is one sentence: **the interface is translated, the data is not.**

### What counts as data

Anything a person typed, and anything the ledger wrote down. Account names,
item names, entry descriptions, references. None of it is ever passed through
a dictionary on the way to a screen.

The only text the _tenant's_ locale touches is the handful of descriptions the
ledger generates for itself — the closing entry, a revaluation, the cost of
goods sold behind a shipment, a reversal. Those are written once, at the moment
the entry is posted, and become part of the record. `src/lib/i18n/ledger.ts`
holds them, deliberately apart from the interface dictionary, because the two
are governed by different rules: an interface string may be re-rendered in a
different language on the next request, and one of these may never be.

### The interface locale is a cookie, and the theme is not

These sit next to each other in the sidebar and look like the same kind of
setting. They are not, and the difference decides the mechanism.

A theme is a handful of CSS variables. Getting it wrong for one frame is a
flash of the wrong colour, which a blocking script in `<head>` fixes by reading
`localStorage` before the first paint. That is why the theme never touches the
server.

A language is the _text_, and the text is rendered into the HTML on the server.
Sending English and correcting it after hydration would mean shipping every
dictionary to every visitor and watching the entire page re-word itself in
front of them. So the language is a cookie: it arrives with the request, the
server renders once, and there is no wrong first paint to fix.

### Dictionaries do not reach the browser

The message catalogue is imported by Server Components only. The two Client
Components that need words — the navigation, which reads the current path, and
the stock forms — take them as props. Ten nav labels crossing the boundary as
strings costs less than one dictionary crossing it as a module, and it makes a
useful constraint visible: a message that takes an argument is a _function_,
functions cannot be serialised across that boundary, so such messages are
resolved on the server and handed over already finished.

### A missing translation is a compile error

`en.ts` is declared `as const` and every other language is typed as its widened
shape. A key that has not been translated will not build, and neither will a
message whose arity differs between languages. This matters more than it
sounds: a half-translated interface is invisible to whoever did the
translating, because they read straight past the words in their own second
language.

### Two pages stay in English

`/api-reference` documents an HTTP API whose field names, error codes and
examples are English, and will be read by somebody writing code against it.
Translating the prose around `unbalanced_transaction` while leaving
`unbalanced_transaction` alone would make the page harder to use, not easier.
`/webhooks` is the same audience for the same reason. This is a boundary, not
an omission, and it is drawn where the reader stops being an accountant and
starts being an integrator.

## Consequences

**The seed is monolingual.** The demo's books are Vietnamese throughout, and an
English-speaking reviewer sees English chrome over Vietnamese records — which
is exactly what they would see if they were handed a real Vietnamese company's
ledger, and is the honest demonstration. The account codes carry the meaning
across: `632` is `632` in every language.

**Adding a language is a file and a compile.** `LOCALES`, a new message file,
and the type checker names everything still missing.

**`organizations.locale` cannot be changed retroactively.** Switching it
changes what _future_ generated descriptions say and leaves posted entries
exactly as they are, which is the only behaviour consistent with an append-only
ledger. Nothing offers to "translate the books", because that would mean
editing history.

## Alternatives considered

**Bilingual strings**, which is what was there. Rejected above: it produces
text in no language, and it scales to exactly two.

**Translating account names through the interface dictionary.** Tempting,
because the chart templates already ship a name and an English `note`. Rejected
because a tenant renames and adds accounts the moment they start working, and a
dictionary that covers the ones we shipped and not the ones they made is worse
than one that covers none — it makes the gap look like a bug rather than a
boundary. The `note` is documentation on the template, not a translation of the
account.

**Putting the locale in the URL** (`/vi/stock`), which is the conventional
answer and the right one for a public site that wants each language indexed
separately. Rejected because this application is behind a sign-in, every route
would double, and every internal link would have to carry the prefix. The one
thing it buys — a shareable link that forces a language — is not something
anyone has asked for here.
