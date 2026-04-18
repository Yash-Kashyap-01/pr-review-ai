import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Not implemented" },
    {
      status: 400,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
