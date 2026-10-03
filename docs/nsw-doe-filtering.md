# NSW DoE web filtering — what blocks games at school

Researched 2026-09-23 for the catalog quality audit ([catalog-quality.md](./catalog-quality.md)).
The question: which catalog games will load for a student on a NSW Department of Education
(DoE) school network? We have no DoE network to test from right now, so this document
separates what sources **state** from what we **infer**, and says how each catalog host got
its status in [`scripts/data/host-filter-status.json`](../scripts/data/host-filter-status.json).

## Summary

- The filter is DoE's **"Secure Internet at Edge" (I@E)**, an on-site firewall and web filter
  at each school, centrally managed. DoE's own documents name **Palo Alto Networks**
  (2018–2021). From 2022 DoE says **"Palo Alto or Fortinet"**, and DoE's 2026–27 procurement
  plan lists an **"Enhanced Internet Edge SOA (fortinet)"**. A given school today could be on
  either vendor.
- **Games is a category students cannot access.** DoE's staff guide shows the Steam site
  "categorised as games and access is only allowed for staff".
- **Uncategorised sites are blocked for students**, historically — which matters for small
  mirror hosts that no vendor has categorised.
- **There is no public way to check a domain against the DoE filter.** DoE's Web Filter Check
  tool is staff-only and works only on the DoE network. Both vendors' public URL-category
  lookups sit behind a CAPTCHA, so we did not script them.
- Result for the catalog: **7,633 games are on hosts measured blocked**, 1,102 more are on
  hosts that are likely blocked, **4,726 are on hosts likely allowed** (mostly Unity Play), and
  184 are unknown. The browse page's **School network** filter shows the last two groups.

## 1. Who runs the filter

**Stated by sources**

| Year | Statement                                                                                                                                                                                                     | Source                                                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2018 | Schools on Internet Edge bypass the central filter; each "will also receive a centrally-managed Paloalto router, firewall and internet filter".                                                               | [Connect.T4L fact sheet](https://schoolsequella.det.nsw.edu.au/file/2f92cce9-9993-43b3-bc3d-12c59a7b874f/1/ConnectT4L.zip/ConnectT4L.html)                                                                      |
| 2019 | BYOD troubleshooting guide: login at `https://edgeportal.det.nsw.edu.au:6082/php/...`; block page titled "NSW DoE Secure Internet at Edge" naming the category (e.g. "peer-to-peer").                         | [DoE BYOD troubleshooting guide (PDF)](http://yasshighbyod.weebly.com/uploads/2/6/4/8/26481244/troubleshooting_byos-and-school-owned-non-windows-devices_final.pdf)                                             |
| 2021 | "Schools that are non-Internet at Edge (I@E) use Blue Coat. Schools that are I@E use Palo Alto." "Students of different ages get access to different categories." Page last updated 09-Mar-2021.              | [DoE staff "Web filtering" page, released under GIPA](https://www.righttoknow.org.au/request/7353/response/21020/attach/4/r%20Web%20Page%20for%20release.pdf?cookie_passthrough=1) — checked by reading the PDF |
| 2022 | "About 1,600 schools use Secured Internet Edge (I@E) … local Internet filtering provided through an on-site Palo Alto or Fortinet appliance." Filtering level follows the logged-on user (K, Stage 6, staff). | [news.T4L issue 83](https://t4l.schools.nsw.gov.au/news-t4l/2022/issue83.html) — seen as a search snippet only; the page now redirects                                                                          |
| 2026 | Procurement plan: PP-100436 "Enhanced Internet Edge SOA (fortinet)", and PP-100444 "Network Filtering Hardware SOA" (content filtering, no vendor named). Last updated 29-Jul-2026.                           | [buy.nsw DoE annual procurement plan](https://buy.nsw.gov.au/prcApp/F3244F24-1796-43FF-9ABC469CF0675CF2) — checked                                                                                              |
| 2026 | "When a student or staff member logs onto the department network, web filtering is automatically activated." K–10 get YouTube in restricted mode. (Procedures v01.2.0, 18/06/2026.)                           | [Technology in schools procedures PD-2024-0481-01](https://education.nsw.gov.au/policy-library/policies/pd-2024-0481-01) — checked                                                                              |
| 2022 | DoE uses Zscaler for remote-staff private access and "has no current plans to extend the use of Zscaler to students".                                                                                         | [iTnews, 4 Apr 2022](https://www.itnews.com.au/news/victoria-installing-zscaler-on-students-personal-devices-to-monitor-traffic-577947)                                                                         |

Our own measurement ([game-launch-quality.md](./game-launch-quality.md), 2026-08-10) saw the
same block page title, "NSW DoE Secure Internet at Edge", with TLS intercepted by a CA issued
as `O=NSW Department of Education, CN=edgeportal.det.nsw.edu.au`.

**Inferred**

- The 2019 portal (port 6082, `/php/uid.php`) is PAN-OS's captive portal, and "peer-to-peer"
  is a Palo Alto category name, so that era was Palo Alto.
- The 2022 wording and the 2026 Fortinet standing offer mean some schools are, or are moving
  to, FortiGate. A block page's category name tells you which: Palo Alto uses lowercase
  hyphenated names (`games`, `proxy-avoidance-and-anonymizers`); FortiGuard uses "Games",
  "Proxy Avoidance", "Unrated".
- Zscaler, Netskope, Cisco Umbrella, Forcepoint and Linewize: no source links any of them to
  student filtering.

## 2. What is blocked for students

**Stated by sources**

- **Games**: the 2021 staff guide's video transcript shows the Steam site "categorised as games
  and access is only allowed for staff".
- **By age**: "Students at different ages get access to different categories. Staff can access
  most categories that students are unable to access." (2021)
- **Uncategorised sites**: "Newly created ones or those that have not yet been classified are
  'uncategorised' and by default, are allowed for staff but blocked for students."
  ([DoE Technology News for Schools, 2013](https://schoolsequella.det.nsw.edu.au/file/e659394c-b7b1-4f5e-8cbf-887d555538cc/1/TNFS01-11PDF.zip/TNFS03.pdf), Blue Coat era.)
- **Bypass tools**: students must "avoid using Virtual Private Networks (VPNs) or any tools
  designed to bypass school or department protections"
  ([Digital devices and online services for students procedures](https://education.nsw.gov.au/policy-library/policies/pd-2020-0471-01)).

**Inferred**

- Proxy/anonymiser categories are almost certainly blocked, given the VPN rule, but no source
  lists them.
- We found no per-school category settings. The only local override documented is for YouTube
  videos; other unblocks go through EDConnect centrally.
- Learning games that are categorised as education (Mathletics, Reading Eggs) work; a site
  categorised as Games does not, whatever its content. There is no "educational games"
  exception in any source we found.

## 3. How to check a domain

| Route                             | Who can use it                  | Scriptable? | Notes                                                                                                                                                                                                                            |
| --------------------------------- | ------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DoE **Web Filter Check** tool     | Staff, on the DoE network only  | No          | Staff Portal → My Applications → "Internet Filtering – Web Filter Check". Up to 50 URLs; shows category and allowed/denied per year group, with a link to request block/unblock/re-categorise. The most reliable check there is. |
| EDConnect request / 1300 32 32 32 | Staff                           | No          | "Website filtering query" form to unblock or re-categorise a site.                                                                                                                                                               |
| Students                          | —                               | —           | Told: "If you believe you should have access to this page, let your teacher know."                                                                                                                                               |
| Palo Alto **Test A Site**         | Public, with a Google reCAPTCHA | No          | [urlfiltering.paloaltonetworks.com](https://urlfiltering.paloaltonetworks.com/); logging in avoids the CAPTCHA, and change requests need a login from 15 Mar 2026. No public API.                                                |
| **FortiGuard** Web Filter Lookup  | Public, with a CAPTCHA          | No          | [fortiguard.com/webfilter](https://www.fortiguard.com/webfilter); a paid API exists behind a Fortinet developer token.                                                                                                           |

No DoE list of blocked or allowed domains is published. We did not work around either
vendor's CAPTCHA, so **no host in the catalog was looked up in a vendor database**.

**The practical next step** is for a teacher to paste the catalog's hosts (the `hosts` keys in
`scripts/data/host-filter-status.json`, 198 of them) into the Web Filter Check tool — 50 per
batch, four batches — and record the results in `host-status.mjs` as measured evidence.

## 4. Mirrors on github.io and Google Sites

- DoE schools publish their own pages on `sites.google.com/education.nsw.gov.au/...`, and DoE
  provides Google Workspace to students, so `sites.google.com` is not blocked as a whole
  ([Google Workspace at DoE](https://education.nsw.gov.au/technology/products-and-services/software/googleworkspace)).
- Both vendors can categorise a single subdomain or path once TLS is intercepted, so one
  Google Site or one `*.github.io` mirror can be blocked while the parent domain stays open.
  That fits our measurement: `abinbins.github.io` passed, which says nothing about other
  `github.io` sites.
- Whether a small mirror works depends on whether the vendor has categorised it yet, and
  unrated sites have historically been blocked for students.

## 5. How the catalog's host status was derived

[`scripts/catalog-quality/host-status.mjs`](../scripts/catalog-quality/host-status.mjs) lists
every host a game loads from — the embed host, the host a local shell's iframe points at, any
redirect target, the jsDelivr gadget behind a Google Sites page, and `cdn.play.unity.com` for
Unity builds — and applies these rules in order, recording the evidence and source next to each
status:

| Status           | Rule                                                                                                                                                                                                                                                                                                  | Hosts (games)   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `blocked`        | Returned the "NSW DoE Secure Internet at Edge" 403 page when measured on a DoE network: `games.crazygames.com`, `app-*.games.s3.yandex.net` (Playhop), `cdn2.addictinggames.com`, `www.coolmathgames.com`.                                                                                            | 4 (7,633)       |
| `likely-allowed` | Measured reachable on a DoE network (`play.unity.com` and Unity CDN — 20/20 Unity games launched there; `cdn.jsdelivr.net`; `abinbins.github.io`), or used by DoE itself (`sites.google.com`).                                                                                                        | 5 (8,683 links) |
| `likely-blocked` | Same site as a measured block (`prod.addictinggames.com`, `playhop.com`, other `*.crazygames.com`), a `.io` game domain (most were blocked when measured), or a games portal/publisher (`fnf-games.io`, GameDistribution, GamePix, itch.io, Shockwave, browser-MMO publishers), or gambling/ad hosts. | 115             |
| `unknown`        | No measurement and no category evidence, e.g. `cdn.mathgames.com`, `www.playgeography.com`, `gogh-strike.surge.sh`, one-off mirrors.                                                                                                                                                                  | 74              |

A game's DoE status is the **worst** status among its hosts (blocked > likely-blocked >
unknown > likely-allowed), and travels into the catalog index as the one-letter field `d`
(`b`, `l`, `a`, `?`).

Thumbnail hosts are recorded separately under `thumbnailHosts`: a blocked cover image makes a
card look empty but does not stop the game. `imgs.crazygames.com` and `prod.addictinggames.com`
are likely blocked, `play.unity.com` and `sites.google.com` likely allowed, and
`avatars.mds.yandex.net` unknown.

Per-game counts (2026-09-23): 7,633 blocked, 1,102 likely blocked, 4,726 likely allowed,
184 unknown.

### Caveats

- "Likely allowed" is not a promise. The Unity Play and Drive U 7 measurements were one school
  on one day, and either vendor re-categorises sites over time.
- Drive U 7's Google Sites pages refuse to be framed (`X-Frame-Options: DENY`), so on a school
  network they only work in the desktop app, whose relay fetches them server-side — and that
  relay's requests go through the same filter.
- A game on an allowed host can still load assets or an SDK from a blocked one. The probe only
  follows the page itself, not everything the game fetches at runtime.
