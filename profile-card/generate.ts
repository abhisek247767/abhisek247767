import { writeFileSync, mkdirSync, readFileSync } from "fs";
import path from "path";
import sharp from "sharp";

const CONFIG_PATH = path.join(import.meta.dir, "config.json");
const OUTPUT_DIR = path.join(import.meta.dir, "output");

const FONT_SIZE = 14;
const CHAR_WIDTH = FONT_SIZE * 0.6;
const LINE_HEIGHT = FONT_SIZE * 1.6;
const PADDING = 24;
const GAP_COLS = 4;
const ART_COLS = 46;
const ART_ROWS = 30;
const INFO_COLS = 52;
const NUM_TONES = 4;
const RAMP = " .:-=+*#%@";

type InfoRow = { label: string; value: string };

type Config = {
  githubUsername: string;
  promptUser: string;
  promptHost: string;
  avatarImage?: string;
  asciiArt?: string[];
  systemInfo: InfoRow[];
  contact: { email?: string; linkedin?: string; twitter?: string; website?: string };
};

type Stats = {
  repos: number;
  followers: number;
  stars: number;
  commits: number;
  contributions: number;
};

type Theme = {
  bg: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  art: string[];
};

type ArtCell = { char: string; toneIndex: number };

const THEMES: Record<"light" | "dark", Theme> = {
  light: {
    bg: "#ffffff",
    border: "#d0d7de",
    text: "#24292f",
    muted: "#d18616",
    accent: "#0969da",
    art: ["#8dbdff", "#4b91f1", "#0969da", "#0550ae"],
  },
  dark: {
    bg: "#0d1117",
    border: "#30363d",
    text: "#c9d1d9",
    muted: "#8b949e",
    accent: "#58a6ff",
    art: ["#1f6feb", "#388bfd", "#58a6ff", "#a5d6ff"],
  },
};

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.error(
    "Missing GitHub token. Export GH_TOKEN (a personal access token with read:user scope) before running `bun run image:create`."
  );
  process.exit(1);
}

async function graphql(query: string, variables: Record<string, unknown>) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { errors?: unknown; data?: any };
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors));
  }
  return json.data;
}

async function fetchStats(login: string): Promise<Stats> {
  const profile = await graphql(
    `query($login: String!) {
      user(login: $login) {
        createdAt
        followers { totalCount }
        repositories(ownerAffiliations: OWNER, isFork: false, first: 100, orderBy: {field: STARGAZERS, direction: DESC}) {
          totalCount
          nodes { stargazerCount }
        }
      }
    }`,
    { login }
  );

  const user = profile.user;
  const stars = user.repositories.nodes.reduce(
    (sum: number, r: { stargazerCount: number }) => sum + r.stargazerCount,
    0
  );

  const createdYear = new Date(user.createdAt).getFullYear();
  const currentYear = new Date().getFullYear();

  let commits = 0;
  let contributions = 0;

  for (let year = createdYear; year <= currentYear; year++) {
    const from = `${year}-01-01T00:00:00Z`;
    const to = `${year}-12-31T23:59:59Z`;
    const data = await graphql(
      `query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            totalCommitContributions
            contributionCalendar { totalContributions }
          }
        }
      }`,
      { login, from, to }
    );
    commits += data.user.contributionsCollection.totalCommitContributions;
    contributions += data.user.contributionsCollection.contributionCalendar.totalContributions;
  }

  return {
    repos: user.repositories.totalCount,
    followers: user.followers.totalCount,
    stars,
    commits,
    contributions,
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Crop to center of image (simulates face crop)
async function cropToFace(buffer: Buffer): Promise<Buffer> {
  try {
    console.log("Cropping to center...");
    const metadata = await sharp(buffer).metadata();
    if (metadata.width && metadata.height) {
      const size = Math.min(metadata.width, metadata.height);
      const left = Math.floor((metadata.width - size) / 2);
      const top = Math.floor((metadata.height - size) / 2);
      const result = await sharp(buffer)
        .extract({ left, top, width: size, height: size })
        .toBuffer();
      return Buffer.from(result);
    }
    return buffer;
  } catch (error) {
    console.warn("Center crop failed, using original image:", (error as Error).message);
    return buffer;
  }
}

// Turns any image (local file path or URL) into a grid of density characters + tone buckets.
async function imageToAsciiGrid(source: string, cols: number, rows: number): Promise<ArtCell[][]> {
  let buffer = /^https?:\/\//.test(source)
    ? Buffer.from(await (await fetch(source)).arrayBuffer())
    : readFileSync(path.isAbsolute(source) ? source : path.join(import.meta.dir, source));

  // Step 1: Crop to face
  console.log("Cropping to center...");
  const cropped = await cropToFace(buffer);
  buffer = Buffer.from(cropped);

  // Step 2: Sharpen
  console.log("Sharpening...");
  // Step 3: Resize to 46×30
  console.log(`Resizing to ${cols}×${rows}...`);
  const { data, info } = await sharp(buffer)
    .resize(cols, rows, { fit: "fill" })
    .sharpen({
      sigma: 2,
      m1: 1.5,
      m2: 3,
    })
    .greyscale()
    .normalize()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Step 5: ASCII conversion
  console.log("Converting to ASCII...");
  const grid: ArtCell[][] = [];
  for (let y = 0; y < rows; y++) {
    const row: ArtCell[] = [];
    for (let x = 0; x < cols; x++) {
      const darkness = 1 - data[y * info.width + x] / 255;
      const toneIdx = Math.min(NUM_TONES - 1, Math.floor(darkness * NUM_TONES));
      
      // Background threshold - increased to remove more noise
      if (darkness < 0.7) {
        row.push({
          char: " ",
          toneIndex: 0,
        });
        continue;
      }

      const rampIdx = Math.min(
        RAMP.length - 1,
        Math.floor(darkness * RAMP.length)
      );

      row.push({
        char: RAMP[rampIdx],
        toneIndex: toneIdx,
      });
    }
    grid.push(row);
  }
  return grid;
}

// Generic radial density placeholder, used only if no image could be loaded.
function defaultArtGrid(rows: number, cols: number): ArtCell[][] {
  const cx = cols / 2;
  const cy = rows / 2;
  const aspect = LINE_HEIGHT / CHAR_WIDTH;
  const maxDist = Math.sqrt(cx * cx + (cy * aspect) ** 2);

  const grid: ArtCell[][] = [];
  for (let y = 0; y < rows; y++) {
    const row: ArtCell[] = [];
    for (let x = 0; x < cols; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + ((y - cy) * aspect) ** 2);
      const darkness = 1 - Math.min(1, dist / (maxDist * 0.75));
      const rampIdx = Math.max(0, Math.floor(darkness * (RAMP.length - 1)));
      const toneIdx = Math.max(0, Math.min(NUM_TONES - 1, Math.floor(darkness * NUM_TONES)));
      row.push({ char: RAMP[rampIdx], toneIndex: toneIdx });
    }
    grid.push(row);
  }
  return grid;
}

function customArtGrid(lines: string[]): ArtCell[][] {
  return lines.map((line, y) => Array.from(line).map((char) => ({ char, toneIndex: y % NUM_TONES })));
}

async function resolveArtGrid(config: Config): Promise<ArtCell[][]> {
  if (config.asciiArt && config.asciiArt.length > 0) {
    return customArtGrid(config.asciiArt);
  }
  const source = config.avatarImage || `https://github.com/${config.githubUsername}.png?size=200`;
  try {
    return await imageToAsciiGrid(source, ART_COLS, ART_ROWS);
  } catch (error) {
    console.error(`Could not load avatar image from "${source}" (${(error as Error).message}); using placeholder art.`);
    return defaultArtGrid(ART_ROWS, ART_COLS);
  }
}

function padLabel(label: string, width: number): string {
  return label + ":" + " ".repeat(Math.max(1, width - label.length + 1));
}

function sectionHeader(title: string, totalCols: number): string {
  const prefix = `- ${title} `;
  const dashes = Math.max(totalCols - prefix.length - 2, 3);
  return prefix + "-".repeat(dashes) + "--";
}

function buildInfoLines(config: Config, stats: Stats): InfoRow[][] {
  const contactRows: InfoRow[] = [
    config.contact.email && { label: "Email", value: config.contact.email },
    config.contact.linkedin && {
      label: "LinkedIn",
      value: config.contact.linkedin.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "").replace(/\/$/, ""),
    },
    config.contact.twitter && {
      label: "X",
      value: "@" + config.contact.twitter.replace(/^https?:\/\/(www\.)?x\.com\//, ""),
    },
    config.contact.website && { label: "Website", value: config.contact.website.replace(/^https?:\/\//, "") },
  ].filter(Boolean) as InfoRow[];

  const statsRows: InfoRow[] = [
    { label: "Repos", value: stats.repos.toLocaleString() },
    { label: "Stars", value: stats.stars.toLocaleString() },
    { label: "Commits", value: stats.commits.toLocaleString() },
    { label: "Followers", value: stats.followers.toLocaleString() },
    { label: "Contributions", value: stats.contributions.toLocaleString() },
  ];

  return [config.systemInfo, contactRows, statsRows];
}

function buildCard(config: Config, stats: Stats, artGrid: ArtCell[][], theme: Theme): string {
  const artCols = Math.max(ART_COLS, ...artGrid.map((r) => r.length));

  const sections = buildInfoLines(config, stats);
  const sectionTitles = ["", "Contact", "GitHub Stats"];

  type Line = { segments: { text: string; fill: string }[] };
  const infoLines: Line[] = [];

  sections.forEach((rows, i) => {
    if (sectionTitles[i]) {
      infoLines.push({ segments: [{ text: sectionHeader(sectionTitles[i], INFO_COLS), fill: theme.muted }] });
    }
    const labelWidth = Math.max(...rows.map((r) => r.label.length), 0);
    for (const row of rows) {
      infoLines.push({
        segments: [
          { text: padLabel(row.label, labelWidth), fill: theme.muted },
          { text: row.value, fill: theme.text },
        ],
      });
    }
  });

  const promptLine = `${config.promptUser}@${config.promptHost}`;
  const totalRows = Math.max(artGrid.length, infoLines.length);

  const artColStart = PADDING;
  const infoColStart = PADDING + (artCols + GAP_COLS) * CHAR_WIDTH;
  const width = infoColStart + INFO_COLS * CHAR_WIDTH + PADDING;

  const headerY = PADDING + FONT_SIZE;
  const ruleY = headerY + LINE_HEIGHT * 0.7;
  const bodyStartY = ruleY + LINE_HEIGHT;
  const height = bodyStartY + totalRows * LINE_HEIGHT + PADDING;

  const parts: string[] = [];

  parts.push(
    `<text x="${artColStart}" y="${headerY}" font-size="${FONT_SIZE}" font-weight="700" font-family="Consolas, 'Courier New', monospace" fill="${theme.accent}">${escapeXml(
      promptLine
    )}</text>`
  );
  parts.push(
    `<text x="${artColStart}" y="${ruleY}" font-size="${FONT_SIZE}" font-family="Consolas, 'Courier New', monospace" fill="${theme.muted}">${"-".repeat(
      promptLine.length
    )}</text>`
  );

  artGrid.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (cell.char === " ") return;
      const color = theme.art[cell.toneIndex % theme.art.length];
      parts.push(
        `<text x="${artColStart + x * CHAR_WIDTH}" y="${bodyStartY + y * LINE_HEIGHT}" font-size="${FONT_SIZE}" font-family="Consolas, 'Courier New', monospace" fill="${color}">${escapeXml(
          cell.char
        )}</text>`
      );
    });
  });

  infoLines.forEach((line, i) => {
    const y = bodyStartY + i * LINE_HEIGHT;
    const tspans = line.segments
      .map((seg) => `<tspan fill="${seg.fill}">${escapeXml(seg.text)}</tspan>`)
      .join("");
    parts.push(
      `<text x="${infoColStart}" y="${y}" xml:space="preserve" font-size="${FONT_SIZE}" font-family="Consolas, 'Courier New', monospace">${tspans}</text>`
    );
  });

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
<rect x="0" y="0" width="${width}" height="${height}" rx="12" fill="${theme.bg}" stroke="${theme.border}" stroke-width="1"/>
${parts.join("\n")}
</svg>`;
}

async function main() {
  const config: Config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  const [stats, artGrid] = await Promise.all([fetchStats(config.githubUsername), resolveArtGrid(config)]);

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(path.join(OUTPUT_DIR, "card-light.svg"), buildCard(config, stats, artGrid, THEMES.light));
  writeFileSync(path.join(OUTPUT_DIR, "card-dark.svg"), buildCard(config, stats, artGrid, THEMES.dark));

  console.log(`Generated profile card for ${config.githubUsername}:`, stats);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
