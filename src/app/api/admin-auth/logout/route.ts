import { createAdminLogoutResponse } from "@/lib/auth/adminAuth";

export const dynamic = "force-dynamic";

export async function POST() {
  return createAdminLogoutResponse();
}
