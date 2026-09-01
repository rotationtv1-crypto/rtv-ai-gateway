/**
 * EPG schedule for rtv-broadcast.
 * Source of truth for CH 01-04, 06, 30-33.
 * Optional KV_CACHE binding warms key epg:guide (ttl 120s).
 */

export interface EpgProgram {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  description: string;
  category: string;
  isLive: boolean;
}

export interface EpgChannel {
  number: string;
  name: string;
  category: string;
  streamUrl: string;
  programs: EpgProgram[];
}

export interface EpgEnv {
  EPG_CACHE?: KVNamespace;
  STREAM_HLS_DEFAULT?: string;
  STREAM_HLS_01?: string;
  STREAM_HLS_02?: string;
  STREAM_HLS_03?: string;
  STREAM_HLS_04?: string;
  STREAM_HLS_06?: string;
  STREAM_HLS_30?: string;
  STREAM_HLS_31?: string;
  STREAM_HLS_32?: string;
  STREAM_HLS_33?: string;
  STREAM_CUSTOMER?: string;
  STREAM_UID_01?: string;
  STREAM_UID_02?: string;
  STREAM_UID_03?: string;
  STREAM_UID_04?: string;
  STREAM_UID_06?: string;
  STREAM_UID_30?: string;
  STREAM_UID_31?: string;
  STREAM_UID_32?: string;
  STREAM_UID_33?: string;
}

const CHANNEL_DEFS: Array<{
  number: string;
  name: string;
  category: string;
  titles: string[];
}> = [
  { number: '01', name: 'RTV News', category: 'News', titles: ['Breaking Headlines', 'World Report', 'Tech Digest', 'Market Watch', 'Evening Roundup'] },
  { number: '02', name: 'RTV Sports', category: 'Sports', titles: ['Premier League Live', 'NBA Tonight', 'UFC Fight Night', 'F1 Qualifying', 'Sports Center'] },
  { number: '03', name: 'RTV Crypto', category: 'Crypto', titles: ['Bitcoin Analysis', 'DeFi Deep Dive', 'NFT Marketplace', 'Chain Reactions', 'Whale Watch'] },
  { number: '04', name: 'RTV Quantum', category: 'Quantum', titles: ['Quantum Computing 101', 'Entanglement Hour', 'Qubit Chronicles', 'Superposition', 'Observer Effect'] },
  { number: '06', name: 'RTV Main', category: 'Main', titles: ['Morning Show', 'Afternoon Live', 'Prime Time', 'Late Night RTV', 'Overnight'] },
  { number: '30', name: 'RTV Movies', category: 'Movies', titles: ['Action Block', 'Sci-Fi Marathon', 'Comedy Hour', 'Drama Spotlight', 'Documentary'] },
  { number: '31', name: 'RTV Cinema', category: 'Movies', titles: ['Director Cut', 'World Cinema', 'Festival Pick', 'Midnight Feature', 'Encore'] },
  { number: '32', name: 'RTV Indie', category: 'Movies', titles: ['Indie Spotlight', 'Shorts Block', 'Auteur Hour', 'Limited Release', 'After Hours'] },
  { number: '33', name: 'RTV Classics', category: 'Movies', titles: ['Golden Age', 'Studio Vault', 'Restored Print', 'Matinee Classic', 'Late Show'] },
];

function hlsFor(env: EpgEnv, number: string): string {
  const direct = (env as Record<string, string | undefined>)[`STREAM_HLS_${number}`];
  if (direct) return direct;
  const uid = (env as Record<string, string | undefined>)[`STREAM_UID_${number}`];
  if (uid && env.STREAM_CUSTOMER) {
    return `https://${env.STREAM_CUSTOMER}.cloudflarestream.com/${uid}/manifest/video.m3u8`;
  }
  return env.STREAM_HLS_DEFAULT || '';
}

function buildSchedule(env: EpgEnv, nowMs = Date.now()): EpgChannel[] {
  const now = new Date(nowMs);
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);

  return CHANNEL_DEFS.map((def) => {
    const programs: EpgProgram[] = [];
    for (let h = 0; h < 28; h++) {
      const start = dayStart + h * 3600_000;
      const end = start + 3600_000;
      const title = def.titles[h % def.titles.length];
      programs.push({
        id: `${def.number}-${h}`,
        title,
        startTime: new Date(start).toISOString(),
        endTime: new Date(end).toISOString(),
        description: `${def.name}: ${title}`,
        category: def.category,
        isLive: nowMs >= start && nowMs < end,
      });
    }
    return {
      number: def.number,
      name: def.name,
      category: def.category,
      streamUrl: hlsFor(env, def.number),
      programs,
    };
  });
}

const CACHE_KEY = 'epg:guide';
const CACHE_TTL = 120;

export async function getEpgGuide(env: EpgEnv): Promise<{ channels: EpgChannel[]; cached: boolean; generatedAt: string }> {
  if (env.EPG_CACHE) {
    const hit = await env.EPG_CACHE.get(CACHE_KEY);
    if (hit) {
      try {
        const parsed = JSON.parse(hit) as EpgChannel[];
        const stamped = parsed.map((ch) => ({
          ...ch,
          programs: ch.programs.map((p) => {
            const start = Date.parse(p.startTime);
            const end = Date.parse(p.endTime);
            const n = Date.now();
            return { ...p, isLive: n >= start && n < end };
          }),
        }));
        return { channels: stamped, cached: true, generatedAt: new Date().toISOString() };
      } catch {
        /* rebuild */
      }
    }
  }

  const channels = buildSchedule(env);
  if (env.EPG_CACHE) {
    await env.EPG_CACHE.put(CACHE_KEY, JSON.stringify(channels), { expirationTtl: CACHE_TTL });
  }
  return { channels, cached: false, generatedAt: new Date().toISOString() };
}
