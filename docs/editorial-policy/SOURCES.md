# Initial source policy

The first live validation uses a small, explicit allowlist of institutional RSS
feeds. Discovery through a feed does not imply permission to republish its
articles. Article content is processed ephemerally in memory and discarded. The
pipeline retains citations, checksums, and original project summaries rather
than source pages, article copies, or verbatim evidence passages.

## Starter feeds

| Source | Classification | Feed documentation | Reason for inclusion |
| --- | --- | --- | --- |
| NASA News | Primary | [NASA RSS feeds](https://www.nasa.gov/rss-feeds/) | Official agency announcements and science updates |
| MIT Research News | Reporting | [MIT News RSS](https://news.mit.edu/rss) | Institution-operated reporting about research |
| NIST News | Primary | [NIST RSS feeds](https://www.nist.gov/coo/nist-rss-feeds) | Official measurement, standards, and applied-science updates |

The machine-readable allowlist is
`pipeline/config/source-configuration.initial.v1.json`. It intentionally starts
small. Adding a source requires reviewing its feed documentation, article-access
terms, host and redirect behavior, publication metadata, and editorial role.

## Reference boundary

The reference implementation discovers stories only through reviewed official
RSS and Atom feeds. It does not depend on social feeds or unbounded website
collection. A feed entry supplies discovery metadata and a link; it does not by
itself grant permission to analyze or republish the linked page.

This is an implementation boundary, not a limit on the project. Contributors
may add adapters for APIs, datasets, archives, private knowledge bases, or other
information sources when they have permission to access and use them. Each
adapter must preserve provenance and document its access, analysis, retention,
and publication permissions.

## Candidate feed registry

The following official feeds are promising candidates for a broader source
mix. They are not enabled by this table. Each still requires a source-policy
review and a live validation before being added to the machine-readable
allowlist.

| Source | Editorial role | Coverage |
| --- | --- | --- |
| [NSF News](https://www.nsf.gov/rss) | Primary institution | Science, engineering, education |
| [DOE Office of Science](https://science.osti.gov/RSS) | Primary institution | Energy, computing, physics, climate |
| [National Cancer Institute](https://www.cancer.gov/syndication/rss) | Primary institution | Cancer research and public health |
| [CDC](https://www2c.cdc.gov/medialibrary/) | Primary institution | Public health and epidemiology |
| [USGS News](https://www.usgs.gov/news/news-releases/national-news-releases) | Primary institution | Earth science, water, hazards, ecosystems |
| [NOAA National Ocean Service](https://oceanservice.noaa.gov/rss.html) | Primary institution | Oceans, coasts, climate, conservation |
| [ESA](https://www.esa.int/Services/RSS_Feeds) | Primary institution | Space science and Earth observation |
| [European Commission Research and Innovation](https://research-and-innovation.ec.europa.eu/news/stay-connected_en) | Primary institution | European research and innovation |
| [Horizon Magazine](https://projects.research-and-innovation.ec.europa.eu/ga/node/7459) | Institutional reporting | EU-funded research and its applications |
| [WHO regional news](https://www.emro.who.int/rss-feeds.html) | Primary institution | Public health and international cooperation |
| [UNESCO World Heritage](https://whc.unesco.org/en/news/) | Primary institution | Culture, conservation, and communities |
| [Smithsonian Insider](https://insider.si.edu/rssfeeds/) | Institutional reporting | Science, nature, arts, and history |
| [MIT News](https://news.mit.edu/rss) | Institutional reporting | Research, technology, health, climate, culture |
| [Harvard Gazette](https://news.harvard.edu/gazette/rss-feeds/) | Institutional reporting | Research, health, culture, community |
| [Yale News](https://news.yale.edu/rss-feeds) | Institutional reporting | Research, environment, health, culture |
| [University of Cambridge News](https://www.cam.ac.uk/news-feed-generator) | Institutional reporting | Research across disciplines |
| [ETH Zurich News](https://ethz.ch/content/main/en/utils/rss.html) | Institutional reporting | Science, engineering, climate, health |
| [PLOS](https://journals.plos.org/plosone/s/find-and-read-articles) | Open research | Peer-reviewed science, health, and sustainability |
| [eLife](https://elifesciences.org/alerts) | Open research | Life science and medicine |

University and institutional newsrooms report on their own organizations. They
are valuable direct sources, but consequential claims should also resolve to a
paper, dataset, trial record, public report, or independent corroborating
source. Selection should limit concentration from any one institution and
maintain a useful mix of subjects.

NPR can be evaluated as an optional discovery-only feed. AP and Reuters do not
currently provide a suitable general public feed for the default configuration;
their licensed delivery products can be supported later through optional
adapters when an operator has the necessary agreement.

## Discovery and retrieval rules

- Fetch only configured HTTPS feed and article hosts.
- Use feeds for discovery; fetch full pages only after shortlisting.
- Keep requests bounded, infrequent, and identifiable.
- Do not bypass authentication, paywalls, access controls, or robots directives.
- Do not persist or publish article text or verbatim evidence passages.
- Treat failed or ambiguous sources as unavailable rather than weakening access
  controls.
- Re-review sources before production deployment and whenever their terms or
  delivery behavior changes.

This starter list tests the software, not the breadth or balance of the eventual
daily edition. A production source policy still needs broader subject coverage,
community sources, corroboration rules, corrections, and takedowns.

## Live validation record

On 2026-10-13, a local story-discovery run successfully read the NASA News and
MIT Research News feeds and produced 15 candidates in an eight-day validation
window. One article from each source then passed the bounded HTML fetch and
text-extraction path without storing its text. NASA JPL's documented feed
returned HTTP 403 to the pipeline client, so it was removed from the active
configuration rather than retried or bypassed. NIST News was then added from its
documented RSS directory for the next validation pass. These observations are
operational checks, not permanent guarantees; source behavior must be monitored
and re-reviewed.
