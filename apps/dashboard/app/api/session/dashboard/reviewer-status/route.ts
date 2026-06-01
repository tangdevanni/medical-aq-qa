import { NextResponse } from "next/server";
import { requireSelectedAgencySession } from "../../../../../lib/auth/session";
import { updateBackendAgencyReviewerStatus } from "../../../../../lib/server/backendApi";

export async function POST(request: Request) {
  try {
    const session = await requireSelectedAgencySession();
    const body = (await request.json().catch(() => ({}))) as {
      workItemId?: unknown;
      status?: unknown;
    };
    if (typeof body.workItemId !== "string" || body.workItemId.trim().length === 0) {
      return NextResponse.json({ message: "workItemId is required." }, { status: 400 });
    }
    if (body.status !== "red" && body.status !== "yellow" && body.status !== "green") {
      return NextResponse.json({ message: "status must be red, yellow, or green." }, { status: 400 });
    }

    const updated = await updateBackendAgencyReviewerStatus(session.selectedAgencyId!, {
      workItemId: body.workItemId,
      status: body.status,
      updatedBy: session.name || session.email,
    });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to update reviewer status." },
      { status: 500 },
    );
  }
}
