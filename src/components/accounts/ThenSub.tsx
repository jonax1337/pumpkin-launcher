import { useI18n } from "@/i18n";

/** Dialog-Untertitel „Danach startet {name}.“ – der Name bleibt als React-Knoten fett. */
export function ThenSub({ label }: { label: string }) {
  const { tAround } = useI18n();
  const [before, after] = tAround("components.account.then", "name");
  return (
    <>
      {before}
      <b>{label}</b>
      {after}
    </>
  );
}
