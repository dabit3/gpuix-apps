-- Pandoc filter for untrusted documents rendered to PDF with typst: drops everything that would
-- reach typst as code (raw typst, typst:* attributes, code-position metadata) and replaces images
-- with their description, so typst only lays out text and never reads files or downloads packages.
local KEEP_META = { title = true, subtitle = true, author = true, date = true, abstract = true }

local function scrub(x)
  if x.attr then x.attr = pandoc.Attr(x.attr.identifier, x.attr.classes, {}) end
  return x
end

local function rows(list)
  for _, row in ipairs(list) do
    scrub(row)
    for _, cell in ipairs(row.cells) do scrub(cell) end
  end
end

function Inline(el)
  if el.t == 'Image' then return el.caption end
  if el.t == 'RawInline' then return {} end
  return scrub(el)
end

function Block(el)
  if el.t == 'RawBlock' then return {} end
  if el.t == 'Table' then
    scrub(el.head)
    rows(el.head.rows)
    for _, body in ipairs(el.bodies) do
      scrub(body)
      rows(body.head)
      rows(body.body)
    end
    scrub(el.foot)
    rows(el.foot.rows)
  end
  return scrub(el)
end

function Meta(meta)
  local kept = {}
  for k, v in pairs(meta) do
    if KEEP_META[k] then kept[k] = v end
  end
  return pandoc.Meta(kept)
end
