# Initial source policy

The reference implementation uses an explicit allowlist of RSS feeds.
Discovery through a feed does not imply permission to analyze or republish its
articles. Every enabled source declares either `discovery-only` or
`ephemeral-analysis`. Permitted article content is processed in memory and
discarded. The pipeline retains citations, checksums, and original project
summaries rather than source pages, article copies, or verbatim evidence.
The current repository code evaluates feed metadata, analyzes permitted article
text, and plans art direction with Amazon Nova through AWS-managed Bedrock, not
a self-hosted model. Google image generation still receives an authored visual
prompt with story-derived physical details. See the [data boundary](../DATA_BOUNDARY.md).
These text workers have not yet been deployed to the development account.

## Enabled reference feeds

| Source | Role | Article access | Coverage |
| --- | --- | --- | --- |
| [NASA News](https://www.nasa.gov/rss-feeds/) | Primary | Ephemeral analysis | Space, Earth science, and exploration |
| [UN News](https://www.ungeneva.org/en/news-media/rss) | Institutional reporting | Discovery only | Global public affairs and communities |
| [NPR Top Stories](https://feeds.npr.org/1001/rss.xml) | Reporting | Discovery only | Public affairs, health, culture, and daily news |
| [NPR Arts & Life](https://feeds.npr.org/1008/rss.xml) | Reporting | Discovery only | Arts, books, music, and culture |
| [Smithsonian Magazine](https://www.smithsonianmag.com/rss/) | Reporting | Discovery only | Arts, history, nature, and culture |
| [NSF News](https://www.nsf.gov/rss) | Primary | Ephemeral analysis | Science, engineering, education, and society |
| [National Cancer Institute](https://www.cancer.gov/syndication/rss) | Primary | Ephemeral analysis | Cancer research and public health |
| [NOAA National Ocean Service](https://oceanservice.noaa.gov/rss.html) | Primary | Ephemeral analysis | Oceans, coasts, and conservation |
| [Yale News](https://news.yale.edu/rss-feeds) | Institutional reporting | Ephemeral analysis, `news.yale.edu` only | Culture, environment, health, and research |
| [Positive News](https://www.positive.news/feed/) | Reporting | Ephemeral analysis | Environment, society, economics, and culture |
| [Reasons to be Cheerful](https://reasonstobecheerful.world/feed/) | Reporting | Ephemeral analysis | Community responses to public problems |
| [Global Voices](https://globalvoices.org/feed/) | Reporting | Ephemeral analysis | Languages, culture, civic life, and communities |
| [Next City](https://nextcity.org/feeds/daily) | Reporting | Ephemeral analysis | Cities, housing, neighborhoods, and civic systems |
| [WHO News](https://www.who.int/rss-feeds/news-english.xml) | Primary | Ephemeral analysis | International public health |
| [UNESCO-UNEVOC](https://connect.unevoc.unesco.org/home/rss-feed) | Primary | Ephemeral analysis | Education, skills, and work |
| [Harvard Gazette](https://news.harvard.edu/gazette/feed/) | Institutional reporting | Ephemeral analysis | Health, education, culture, and research |
| [University of Cambridge News](https://www.cam.ac.uk/news/feed) | Institutional reporting | Ephemeral analysis | Health, culture, and research |
| [MIT Research News](https://news.mit.edu/rss) | Institutional reporting | Ephemeral analysis | Research, technology, health, and climate |
| [NIST News](https://www.nist.gov/coo/nist-rss-feeds) | Primary | Ephemeral analysis | Standards, measurement, and applied science |
| [Wikimedia Diff](https://diff.wikimedia.org/feed/) | Community reporting | Discovery only | Public knowledge, culture, and community projects |

The machine-readable allowlist is
`pipeline/config/source-configuration.initial.v1.json`. Adding or changing a
source requires reviewing its feed documentation, article-access terms, robots
directives, host and redirect behavior, publication metadata, and editorial
role. Discovery-only sources may contribute links and feed metadata but their
article pages must not be sent to an analysis provider.

## Reference boundary

The reference implementation discovers stories only through reviewed official
RSS feeds. It does not depend on social feeds or unbounded website
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
| [DOE Office of Science](https://science.osti.gov/RSS) | Primary institution | Energy, computing, physics, climate |
| [CDC](https://www2c.cdc.gov/medialibrary/) | Primary institution | Public health and epidemiology |
| [USGS News](https://www.usgs.gov/news/news-releases/national-news-releases) | Primary institution | Earth science, water, hazards, ecosystems |
| [ESA](https://www.esa.int/Services/RSS_Feeds) | Primary institution | Space science and Earth observation |
| [European Commission Research and Innovation](https://research-and-innovation.ec.europa.eu/news/stay-connected_en) | Primary institution | European research and innovation |
| [Horizon Magazine](https://projects.research-and-innovation.ec.europa.eu/ga/node/7459) | Institutional reporting | EU-funded research and its applications |
| [WHO regional news](https://www.emro.who.int/rss-feeds.html) | Primary institution | Public health and international cooperation |
| [UNESCO World Heritage](https://whc.unesco.org/en/news/) | Primary institution | Culture, conservation, and communities |
| [Smithsonian Insider](https://insider.si.edu/rssfeeds/) | Institutional reporting | Science, nature, arts, and history |
| [ETH Zurich News](https://ethz.ch/content/main/en/utils/rss.html) | Institutional reporting | Science, engineering, climate, health |
| [PLOS](https://journals.plos.org/plosone/s/find-and-read-articles) | Open research | Peer-reviewed science, health, and sustainability |
| [eLife](https://elifesciences.org/alerts) | Open research | Life science and medicine |
| [USDA Rural Development](https://www.rd.usda.gov/newsroom/rss) | Primary institution | Rural communities and infrastructure |
| [European Environment Agency](https://www.eea.europa.eu/en/newsroom/rss-feeds) | Primary institution | Climate, environment, and ecosystems |
| [FAO Newsroom](https://www.fao.org/newsroom/en) | Primary institution | Food systems and agriculture |
| [IRENA](https://www.irena.org/rssfeed) | Primary institution | Renewable energy |
| [USDA Agricultural Research Service](https://www.ars.usda.gov/news-events/rss-feeds/) | Primary institution | Farming and food research |

The October 2026 review kept the Library of Congress out of scope. NSF's
official feed links to `/news/<story>` pages, which are outside its robots
exclusion for `/news/releases`; its text-reuse policy permits most NSF-authored
text. Smithsonian Insider and USGS returned HTTP 403 to feed
requests. ETH Zurich's published copyright terms need further review before
article text is sent to a hosted model. ESA offers a reachable Earth-observation
RSS feed, but its article-use terms have not yet been cleared for that step.
The DOE page lists feed categories, but an appropriate current news feed still
needs live validation. None of these candidates should be treated as enabled
or approved for article analysis.

University and institutional newsrooms report on their own organizations. They
are valuable direct sources, but consequential claims should also resolve to a
paper, dataset, trial record, public report, or independent corroborating
source. Selection should limit concentration from any one institution and
maintain a useful mix of subjects.

AP and Reuters do not currently provide a suitable general public feed for the
default configuration. Their licensed delivery products can be supported later
through optional adapters when an operator has the necessary agreement.

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

On 2026-10-13, all 16 enabled feeds completed a live collection pass. A 24-hour
window produced 54 candidates, which were evaluated and reduced to a factual
ten-story test edition spanning health, education, housing, space, civic
governance, language, and ecological art. Permitted articles were read
ephemerally and only project-authored evidence artifacts were retained.

The run also tightened the source boundary. NPR remains discovery-only and
The Conversation's Atom feed has since been removed from the RSS-only reference
configuration. Smithsonian
returned HTTP 403 for an article request and UN News feed links did not expose a
readable article body, so both remain discovery-only rather than being bypassed.
An early Global Voices extraction selected a promotional card instead of the
main entry; the artifacts were rejected, the extractor was corrected and
regression-tested, and the two pages were reprocessed successfully.

These observations are operational checks, not permanent guarantees. Source
behavior and terms must be monitored and re-reviewed.

On 2026-10-15, the local reference allowlist changed from 16 mixed RSS/Atom
feeds to 19 RSS feeds. NSF, NCI, NOAA National Ocean Service, and Yale News were
added for ephemeral article analysis; The Conversation's Atom feed was removed.
The [NSF](https://www.nsf.gov/policies/digital),
[NCI](https://www.cancer.gov/policies/copyright-reuse), and
[NOAA](https://oceanservice.noaa.gov/about/faq.html) sites publish text-reuse
guidance. Yale's official
RSS feed links to multiple university subdomains, so only `news.yale.edu`
articles enter discovery. The new host filter applies to every configured
source. These are local changes, not an AWS deployment. Feed and article access
must be rechecked before deployment; adding them does not guarantee a
ten-story daily edition. NCI's news-release feed was reachable but its latest
entry in this check was from May 2026, so its expected daily yield is low.

A read-only local collection over a 36-hour October 14–16 window completed all
19 feeds with no failures and returned 62 candidates. Of the four newly enabled
sources, only Yale contributed an in-window candidate, on the reviewed
`news.yale.edu` host. NSF, NCI, and NOAA had no in-window entries. This run
did not call an editorial model or deploy the configuration.

The next local review added Wikimedia Diff as discovery-only. Its official RSS
feed responded successfully and its robots file did not restrict article or feed
paths. The remaining proposed feeds are not enabled: USDA Rural Development and
IRENA returned HTTP 403; FAO's tested feed URL did not resolve to a usable feed;
the USDA ARS feed returns HTTP article links that fail this project's HTTPS-only
policy; and EEA's robots file disallows its `*/rss.xml` paths despite its public
RSS directory. These are current access observations, not judgments about the
publishers. Wikimedia's community posts may carry per-item rights or
attribution considerations, so full-article analysis remains off pending review.
