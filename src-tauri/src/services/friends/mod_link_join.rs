//! Einladungen und Beitreten aus dem Spiel (docs/bridge/README.md, "Operations and consent"). `invite.joinHere` ist der einzige Vorgang, der ändert, was das
//! laufende Spiel tut; er hält deshalb SPEC 6.2 ein: Microsoft-Konto, Zustimmung, Gastgeber erreichbar, die laufende Instanz
//! passt, Besitzer der Verbindung noch einmal geprüft, ein einziger Zuhörer an einer Loopback-Adresse, der nur dem
//! Spielprozess gehört.
use super::consent::{consented, Consent};
use super::errors::mod_error;
use crate::error::AppResult;
use crate::services::friends::contract::{InstanceCandidate, JoinPlan, JoinVerdict, MIN_MC_LABEL};
use crate::services::friends::sanitize;
use crate::services::friends::sessions::FriendSessions;
use crate::services::modbridge::ops::{
    ErrorCode, InvitePlan, JoinHere, OpError, OpOutcome, OpResult, PlanAlternative, PlanVerdict,
    MAX_ALTERNATIVES,
};
use crate::services::modbridge::OpContext;

fn done(result: AppResult<()>) -> OpOutcome {
    result.map(|()| OpResult::empty()).map_err(mod_error)
}

pub(super) async fn invite_decline(sessions: &FriendSessions, invite_id: &str) -> OpOutcome {
    done(sessions.invite_decline(invite_id).await)
}

/// Wie die Einladung zum laufenden Spiel passt und welche anderen Instanzen es gibt (SPEC 5.6).
pub(super) async fn invite_plan(
    sessions: &FriendSessions,
    ctx: &OpContext,
    invite_id: &str,
) -> OpOutcome {
    let (_, plan) = sessions
        .plan_with_running_first(invite_id, ctx.instance_id())
        .await
        .map_err(mod_error)?;
    Ok(OpResult::InvitePlan(plan_for_running(
        &plan,
        ctx.instance_id(),
    )))
}

/// Tritt der Einladung aus dem laufenden Spiel bei und nennt der Mod die Adresse, an die sie verbinden soll.
pub(super) async fn invite_join_here(
    sessions: &FriendSessions,
    ctx: &OpContext,
    invite_id: &str,
) -> OpOutcome {
    let shared = &sessions.shared;
    shared.ensure_enabled().map_err(mod_error)?;
    if !ctx.online_account() {
        return Err(OpError::new(ErrorCode::MsAccountRequired));
    }
    let received = shared.invites.open_invite(invite_id).map_err(mod_error)?;
    let Ok(_one_join_at_a_time) = shared.mods.join_gate.try_lock() else {
        return Err(OpError::new(ErrorCode::Busy));
    };
    if shared.joins.is_active() {
        return Err(OpError::new(ErrorCode::Busy));
    }
    let consent = Consent::social("invite.joinHere", Some(received.invite.from_name.clone()));
    consented(
        shared,
        ctx,
        consent,
        join_running_game(sessions, ctx, invite_id),
    )
    .await
}

/// Nach Zustimmung: Gastgeber erreichen, abgleichen, Besitzer prüfen und Zuhörer binden; siehe docs/bridge/README.md, "In-game navigation and world behavior".
async fn join_running_game(
    sessions: &FriendSessions,
    ctx: &OpContext,
    invite_id: &str,
) -> OpOutcome {
    let (received, plan) = sessions
        .plan_with_running_first(invite_id, ctx.instance_id())
        .await
        .map_err(mod_error)?;
    ensure_running_game_fits(&plan_for_running(&plan, ctx.instance_id()))?;
    ctx.verify_owner().await?;
    let game_pid = ctx
        .game_pid()
        .ok_or_else(|| OpError::new(ErrorCode::Internal))?;
    let (_, address) = sessions
        .start_join_here(&received, ctx.instance_id(), game_pid)
        .await
        .map_err(mod_error)?;
    Ok(OpResult::JoinHere(JoinHere {
        host: address.ip().to_string(),
        port: address.port(),
    }))
}

/// Passt das laufende Spiel nicht, bekommt die Mod das Urteil des Abgleichs (docs/bridge/README.md, "In-game navigation and world behavior").
fn ensure_running_game_fits(plan: &InvitePlan) -> Result<(), OpError> {
    match plan.verdict {
        PlanVerdict::Ready => Ok(()),
        PlanVerdict::VersionUnsupported => {
            Err(OpError::new(ErrorCode::VersionUnsupported).with_param("min", MIN_MC_LABEL))
        }
        PlanVerdict::MissingContent | PlanVerdict::NoInstance => {
            Err(OpError::new(ErrorCode::InstanceMismatch)
                .with_param(
                    "verdict",
                    serde_json::to_value(plan.verdict).unwrap_or_default(),
                )
                .with_param("missing", plan.missing)
                .with_param("extra", plan.extra))
        }
    }
}

/// Verlässt die Welt, der dieses Spiel beigetreten ist; ohne Beitritt gibt es nichts zu tun.
pub(super) fn join_leave(sessions: &FriendSessions, ctx: &OpContext) -> OpOutcome {
    sessions.leave_join_of_instance(ctx.instance_id());
    Ok(OpResult::empty())
}

/// Die Mod meldet, dass das Verbinden scheiterte; ein Beitritt ohne gültige Verbindung endet dann mit `error`.
pub(super) fn join_failed(sessions: &FriendSessions, ctx: &OpContext) -> OpOutcome {
    sessions.fail_join_of_instance(ctx.instance_id());
    Ok(OpResult::empty())
}

/// Der Abgleich aus Sicht des laufenden Spiels: sein Urteil, was ihm fehlt und was es zu viel hat, und die anderen Instanzen,
/// passende zuerst.
fn plan_for_running(plan: &JoinPlan, running_instance_id: &str) -> InvitePlan {
    let running = plan
        .candidates
        .iter()
        .find(|candidate| candidate.instance_id == running_instance_id);
    let count = |mods: usize| u32::try_from(mods).unwrap_or(u32::MAX);
    let alternatives = plan
        .candidates
        .iter()
        .filter(|candidate| candidate.instance_id != running_instance_id)
        .take(MAX_ALTERNATIVES)
        .map(|candidate| PlanAlternative {
            name: sanitize::world_or_instance_name(&candidate.name),
            matches: candidate.matches,
        })
        .collect();
    InvitePlan {
        verdict: verdict_for_running(plan.verdict, running),
        missing: running.map_or(0, |candidate| count(candidate.missing.len())),
        extra: running.map_or(0, |candidate| count(candidate.extra.len())),
        alternatives,
    }
}

/// Der Abgleich urteilt über alle Instanzen („es gibt eine passende“); die Mod will wissen, ob ihr Spiel passt.
fn verdict_for_running(overall: JoinVerdict, running: Option<&InstanceCandidate>) -> PlanVerdict {
    match (overall, running) {
        (JoinVerdict::VersionUnsupported, _) => PlanVerdict::VersionUnsupported,
        (_, Some(candidate)) if candidate.matches => PlanVerdict::Ready,
        (_, Some(_)) => PlanVerdict::MissingContent,
        (_, None) => PlanVerdict::NoInstance,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::friends::contract::{InstanceSummary, ModLoader, ModRef};

    fn mod_ref(name: &str) -> ModRef {
        ModRef {
            title: name.into(),
            file_name: format!("{name}.jar"),
            project_id: None,
        }
    }

    fn candidate(id: &str, matches: bool, missing: usize, extra: usize) -> InstanceCandidate {
        InstanceCandidate {
            instance_id: id.into(),
            name: format!("Welt {id}"),
            matches,
            missing: (0..missing)
                .map(|n| mod_ref(&format!("fehlt{n}")))
                .collect(),
            extra: (0..extra).map(|n| mod_ref(&format!("extra{n}"))).collect(),
        }
    }

    fn plan(verdict: JoinVerdict, candidates: Vec<InstanceCandidate>) -> JoinPlan {
        JoinPlan {
            invite_id: "i1".into(),
            summary: InstanceSummary {
                name: "Insel".into(),
                minecraft_version: "26.3".into(),
                loader: ModLoader::Fabric,
                loader_version: None,
                mod_count: 0,
            },
            verdict,
            candidates,
            create_vanilla: false,
            lookup_failed: false,
        }
    }

    #[test]
    fn a_running_game_that_matches_is_ready_and_the_others_are_alternatives() {
        let all = plan(
            JoinVerdict::Ready,
            vec![
                candidate("run", true, 0, 0),
                candidate("b", true, 0, 0),
                candidate("c", false, 2, 1),
            ],
        );

        let view = plan_for_running(&all, "run");

        assert_eq!(
            (view.verdict, view.missing, view.extra),
            (PlanVerdict::Ready, 0, 0)
        );
        let others: Vec<(&str, bool)> = view
            .alternatives
            .iter()
            .map(|other| (other.name.as_str(), other.matches))
            .collect();
        assert_eq!(
            others,
            [("Welt b", true), ("Welt c", false)],
            "das laufende Spiel gehört nicht zu den Alternativen"
        );
    }

    #[test]
    fn a_running_game_that_misses_content_gets_the_counts_even_if_another_instance_fits() {
        let all = plan(
            JoinVerdict::Ready,
            vec![candidate("b", true, 0, 0), candidate("run", false, 2, 1)],
        );

        let view = plan_for_running(&all, "run");

        assert_eq!(
            (view.verdict, view.missing, view.extra),
            (PlanVerdict::MissingContent, 2, 1)
        );
        assert!(
            view.alternatives[0].matches,
            "die passende Instanz wird angeboten"
        );
    }

    #[test]
    fn a_running_game_of_another_version_or_loader_has_no_instance_and_no_counts() {
        let all = plan(JoinVerdict::Ready, vec![candidate("b", true, 0, 0)]);

        let view = plan_for_running(&all, "run");

        assert_eq!(
            (view.verdict, view.missing, view.extra),
            (PlanVerdict::NoInstance, 0, 0)
        );
        assert_eq!(view.alternatives.len(), 1);
    }

    #[test]
    fn a_host_with_a_too_old_version_is_unsupported_whatever_the_instances_are() {
        let all = plan(JoinVerdict::VersionUnsupported, Vec::new());

        assert_eq!(
            plan_for_running(&all, "run").verdict,
            PlanVerdict::VersionUnsupported
        );
    }

    #[test]
    fn at_most_five_alternatives_are_listed() {
        let many = (0..9)
            .map(|n| candidate(&format!("x{n}"), n == 8, 0, 0))
            .collect();

        assert_eq!(
            plan_for_running(&plan(JoinVerdict::Ready, many), "run")
                .alternatives
                .len(),
            MAX_ALTERNATIVES
        );
    }

    #[test]
    fn only_a_ready_running_game_may_join_and_the_others_are_refused_with_the_verdict() {
        let view = |verdict, missing, extra| InvitePlan {
            verdict,
            missing,
            extra,
            alternatives: Vec::new(),
        };

        assert_eq!(
            ensure_running_game_fits(&view(PlanVerdict::Ready, 0, 0)),
            Ok(())
        );
        let version =
            ensure_running_game_fits(&view(PlanVerdict::VersionUnsupported, 0, 0)).unwrap_err();
        assert_eq!(
            (version.code, version.params["min"].as_str()),
            (ErrorCode::VersionUnsupported, Some("1.16.5"))
        );
        let missing =
            ensure_running_game_fits(&view(PlanVerdict::MissingContent, 3, 1)).unwrap_err();
        assert_eq!(missing.code, ErrorCode::InstanceMismatch);
        assert_eq!(missing.params["verdict"], "missingContent");
        assert_eq!(
            (&missing.params["missing"], &missing.params["extra"]),
            (&3.into(), &1.into())
        );
        let none = ensure_running_game_fits(&view(PlanVerdict::NoInstance, 0, 0)).unwrap_err();
        assert_eq!(
            (none.code, none.params["verdict"].as_str()),
            (ErrorCode::InstanceMismatch, Some("noInstance"))
        );
    }
}
