import { useId, useState } from "react";
import { toast } from "sonner";
import { useAddFriend, useCreateFriendCode } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import { isFriendCodeShape, normalizeFriendCode } from "@/lib/friendCode";
import { Actions, Button, Dialog, DialogActions, TabPanel, Tabs } from "@/ui";
import { EnterCodeTab } from "./EnterCodeTab";
import { MyCodeTab } from "./MyCodeTab";

/** „Mein Code“ gibt einen Code weiter, „Code eingeben“ löst den eines Freundes ein. */
export type AddFriendTab = "mine" | "enter";

const DIALOG_WIDTH = 520;
/** Fest, damit der Dialog beim Erzeugen und Widerrufen von Codes nicht wächst und schrumpft. */
const DIALOG_HEIGHT = 600;

/** Die zwei Wege zum Hinzufügen, je einer öffnet den Dialog auf seinem Reiter. */
export function AddFriendButtons({ onAdd }: { onAdd: (tab: AddFriendTab) => void }) {
  const { t } = useI18n();
  return (
    <Actions wrap>
      <Button variant="primary" icon="plus" onClick={() => onAdd("enter")}>{t("friends.add.button")}</Button>
      <Button icon="link" onClick={() => onAdd("mine")}>{t("friends.myCode.button")}</Button>
    </Actions>
  );
}

/** Freund hinzufügen: den eigenen Code weitergeben oder den eines Freundes eingeben. */
export function AddFriendDialog({ initialTab, onClose }: { initialTab: AddFriendTab; onClose: () => void }) {
  const { t } = useI18n();
  const formId = useId();
  const [tab, setTab] = useState(initialTab);
  const [input, setInput] = useState("");
  const add = useAddFriend();
  const createCode = useCreateFriendCode();
  const ready = isFriendCodeShape(input) && !add.isPending;

  function send() {
    const code = normalizeFriendCode(input);
    if (!code || add.isPending) return;
    add.mutate(code, {
      onSuccess: () => {
        toast.success(t("friends.add.sent"));
        onClose();
      },
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("friends.add.title")}
      width={DIALOG_WIDTH}
      height={DIALOG_HEIGHT}
      busy={add.isPending}
      footer={
        tab === "enter" ? (
          <DialogActions
            cancel={{ label: t("common.cancel"), disabled: add.isPending }}
            confirm={{ label: add.isPending ? t("friends.add.sending") : t("friends.add.send"), width: 160, form: formId, disabled: !ready }}
          />
        ) : (
          <DialogActions cancel={{ label: t("common.close"), width: 124 }} />
        )
      }
    >
      <Tabs
        idBase="add-friend"
        label={t("friends.add.tabsLabel")}
        value={tab}
        onChange={setTab}
        items={[
          { value: "mine", label: t("friends.myCode.tab"), icon: "link" },
          { value: "enter", label: t("friends.enter.tab"), icon: "plus" },
        ]}
      />
      <TabPanel idBase="add-friend" value={tab} className="mt-4">
        {tab === "mine" ? <MyCodeTab create={createCode} /> : <EnterCodeTab formId={formId} input={input} onInput={setInput} onSubmit={send} />}
      </TabPanel>
    </Dialog>
  );
}
