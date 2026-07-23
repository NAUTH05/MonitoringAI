"use client";

// The Live camera wall is mounted once in the dashboard layout so it stays
// alive across nav changes (streams never re-connect). This route only exists
// to drive the sidebar active state; the layout renders LiveWall.
export default function LiveViewPage() {
  return null;
}
