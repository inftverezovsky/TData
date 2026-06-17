import { createAdminLogoutResponse } from "@backend/auth/adminAuth";

export const dynamic = "force-dynamic";

export async function POST() {
  return createAdminLogoutResponse();
}
