import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { actorFromToken, type Actor } from "./auth-core";

export const SESSION_COOKIE = "eleven_session";

export const getActor = cache(async (): Promise<Actor | null> => {
  const jar = await cookies();
  return actorFromToken(jar.get(SESSION_COOKIE)?.value);
});

export async function requireActor(): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect("/login");
  return a;
}
