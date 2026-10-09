import { useId, useState } from "react";
import { toast } from "sonner";
import { useAddFriend, useAddFriendByName, useCreateFriendCode, useFriendsState } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import { BackendError } from "@/lib/errors";
import { isFriendCodeShape, normalizeFriendCode } from "@/lib/friendCode";
import { Actions, Button, Dialog, DialogActions, Hint, TabPanel, Tabs, type TabItem } from "@/ui";
import { EnterCodeTab } from "./EnterCodeTab";
import { defaultAddTab, isMcName, nameTabAvailable, type AddFriendTab } from "./friendsModel";
import { MyCodeTab } from "./MyCodeTab";
import { NameTab } from "./NameTab";
export type { AddFriendTab };


/** Die Wege zum Hinzufügen: der erste öffnet den Dialog auf seinem Reiter, „Mein Code“ auf dem eigenen Code. */
export function AddFriendButtons({ onAdd }: { onAdd: (tab: AddFriendTab) => void }) {
  const { t } = useI18n();
  const directory = useFriendsState().data?.directory.state ?? "unavailable";
  return (
    <Actions wrap>
      <Button variant="primary" icon="plus" onClick={() => onAdd(defaultAddTab(directory))}>{t("friends.add.button")}</Button>
      <Button icon="link" onClick={() => onAdd("mine")}>{t("friends.myCode.button")}</Button>
    </Actions>
  );
}

const isNotFindable = (error: unknown) => error instanceof BackendError && error.key === "errors.friends.nameNotFindable";

/** Freund hinzufügen: per Minecraft-Namen, mit dem Code eines Freundes oder den eigenen Code weitergeben. */
export function AddFriendDialog({ initialTab, onClose }: { initialTab: AddFriendTab; onClose: () => void }) {
  const { t } = useI18n();
  const formId = useId();
  const state = useFriendsState().data;
  const [tab, setTab] = useState(initialTab);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const addByCode = useAddFriend();
  const addByName = useAddFriendByName();
  const createCode = useCreateFriendCode();
  const pending = addByCode.isPending || addByName.isPending;
  const ready = !pending && (tab === "name" ? isMcName(name) : isFriendCodeShape(code));

  function finishRequest(message: string) {
    toast.success(message);
    onClose();
  }

  function sendCode() {
    const normalized = normalizeFriendCode(code);
    if (!normalized || pending) return;
    addByCode.mutate(normalized, {
      onSuccess: () => finishRequest(t("friends.add.sent")),
    });
  }

  function sendName() {
    if (!isMcName(name) || pending) return;
    addByName.mutate(name.trim(), {
      onSuccess: (request) => finishRequest(t("friends.name.sent", { name: request.mcName ?? name.trim() })),
      onError: (error) => {
        if (!isNotFindable(error)) toast.error(error.message);
      },
    });
  }

  function editName(value: string) {
    setName(value);
    addByName.reset();
  }

  const nameSearchUnavailable = !nameTabAvailable(state?.directory.state ?? "unavailable");
  const nameTab: TabItem<AddFriendTab> = { value: "name", label: t("friends.name.tab"), icon: "user" };
  const tabs: TabItem<AddFriendTab>[] = [
    ...(nameSearchUnavailable ? [] : [nameTab]),
    { value: "enter", label: t("friends.enter.tab"), icon: "key" },
    { value: "mine", label: t("friends.myCode.tab"), icon: "share" },
  ];

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("friends.add.title")}
      busy={pending}
      footer={
        tab === "mine" ? (
          <DialogActions cancel={{ label: t("common.close"), className: "w-[124px]" }} />
        ) : (
          <DialogActions
            cancel={{ label: t("common.cancel"), disabled: pending }}
            confirm={{ label: pending ? t("friends.add.sending") : t("friends.add.send"), className: "w-[160px]", form: formId, disabled: !ready }}
          />
        )
      }
    >
      <Tabs idBase="add-friend" label={t("friends.add.tabsLabel")} value={tab} onChange={setTab} items={tabs} />
      <TabPanel idBase="add-friend" value={tab} className="friends-add-panel">
        {tab === "mine" && <MyCodeTab create={createCode} />}
        {tab === "enter" && nameSearchUnavailable && (
          <Hint className="friends-add-hint">{t("friends.name.buildUnavailable")}</Hint>
        )}
        {tab === "enter" && (
          <EnterCodeTab formId={formId} input={code} onInput={setCode} onSubmit={sendCode} />
        )}
        {tab === "name" && state && (
          <NameTab
            formId={formId}
            input={name}
            onInput={editName}
            onSubmit={sendName}
            notFindable={isNotFindable(addByName.error)}
            directory={state.directory}
            findableByName={state.settings.findableByName}
            onShowMyCode={() => setTab("mine")}
          />
        )}
      </TabPanel>
    </Dialog>
  );
}
