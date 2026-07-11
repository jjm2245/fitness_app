import { redirect } from "next/navigation";

// The bare /log route no longer hosts a session — sessions now live on the
// sessions list, and logging happens per-session at /log/[id]. Anything landing
// here (old bookmark, home link) is sent to the list to pick or start one.
export default function LogIndex() {
  redirect("/sessions");
}
