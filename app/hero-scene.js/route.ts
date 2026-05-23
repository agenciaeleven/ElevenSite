import { threeSceneScript } from "../site-content";

export const dynamic = "force-static";
export const revalidate = false;

export function GET() {
  return new Response(threeSceneScript, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=31536000, stale-while-revalidate=86400",
      "Content-Type": "text/javascript; charset=utf-8",
    },
  });
}
