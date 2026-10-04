//! Die Einspeisung eines Starts, zusammengesetzt aus den Bausteinen des Moduls (INGAME 3.3 bis 3.7): Tor, JAR bereitlegen,
//! Startoptionen bauen, den Start in der Brücke anmelden. Scheitert ein Schritt, startet das Spiel ohne Einspeisung,
//! byte-identisch zu einem Start ohne Freunde-Menü; ein Fehler kostet nie den Spielstart.
use std::path::Path;

use super::args::{self, InjectedArgs, UserArgs};
use super::gate::{decide, Decision, LaunchFacts, SkipReason};
use super::index::{ModSource, Node};
use super::materialise::{materialise, MaterialisedJar};
use crate::services::launch::LaunchSpec;
use crate::services::modbridge::{Expectations, ModBridge};

/// Was die Einspeisung von der Brücke braucht: den Start anmelden und den Prozess binden. Die Brücke setzt das um,
/// Tests setzen eine Attrappe ein.
pub trait LaunchRegistry {
    /// Legt den Datensatz des Starts an und liefert die Umgebungsvariablen für das Spiel; leer, wenn die Brücke nicht läuft.
    fn register_launch(&self, instance_id: &str, expectations: Expectations) -> Vec<(String, String)>;

    fn bind_pid(&self, instance_id: &str, pid: u32);
}

impl LaunchRegistry for ModBridge {
    fn register_launch(&self, instance_id: &str, expectations: Expectations) -> Vec<(String, String)> {
        ModBridge::register_launch(self, instance_id, expectations)
    }

    fn bind_pid(&self, instance_id: &str, pid: u32) {
        ModBridge::bind_pid(self, instance_id, pid);
    }
}

/// Alles, was die Einspeisung eines Starts braucht.
pub struct InjectionRequest<'a> {
    pub facts: LaunchFacts<'a>,
    pub instance_id: &'a str,
    pub user: UserArgs<'a>,
    /// „Aktionen im Spiel“ steht auf „Erlauben“ (INGAME 5.5).
    pub pre_granted: bool,
}

/// Warum die Einspeisung nach dem Tor nicht zustande kam.
#[derive(Debug, thiserror::Error)]
pub enum InjectionError {
    #[error("Die Mod ließ sich nicht bereitlegen: {0}")]
    Materialise(#[from] super::materialise::MaterialiseError),
    #[error("Die Startoptionen der Mod ließen sich nicht bauen: {0}")]
    Args(#[from] super::args::ArgsError),
    #[error("Die Brücke zur Mod läuft nicht")]
    BridgeNotRunning,
}

/// Das Ergebnis: eingespeist, vom Tor ausgelassen oder gescheitert.
pub enum Injection {
    Injected(Box<Injected>),
    Skipped(SkipReason),
    Failed(InjectionError),
}

/// Eine vorbereitete Einspeisung. Der Wert hält das JAR (unter Windows mit Freigabe „nur Lesen“) bis zum Spielstart.
pub struct Injected {
    node_id: String,
    args: InjectedArgs,
    env: Vec<(String, String)>,
    _jar: MaterialisedJar,
}

/// Die Argumente des Starts: Optionen der Einspeisung (leer ohne sie) und die Argumente des Nutzers, soweit sie bleiben.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct StartArgs {
    /// Kommen nach den JVM-Argumenten der Version und vor `user_jvm`.
    pub injected_jvm: Vec<String>,
    /// Kommen nach den Spielargumenten der Version und vor `user_game`.
    pub injected_game: Vec<String>,
    pub user_jvm: Vec<String>,
    pub user_game: Vec<String>,
}

/// Entscheidet über die Einspeisung und bereitet sie vor. Die Anmeldung in der Brücke kommt zuletzt: bis dahin hat ein
/// Fehlschlag nichts hinterlassen, das aufzuräumen wäre.
pub fn inject(source: &(impl ModSource + ?Sized), data_dir: &Path, registry: &dyn LaunchRegistry, request: &InjectionRequest) -> Injection {
    let node = match decide(source.index(), &request.facts) {
        Decision::Inject(node) => node,
        Decision::Skip(reason) => return Injection::Skipped(reason),
    };
    match prepare(source, data_dir, registry, request, node) {
        Ok(injected) => Injection::Injected(Box::new(injected)),
        Err(error) => Injection::Failed(error),
    }
}

fn prepare(
    source: &(impl ModSource + ?Sized),
    data_dir: &Path,
    registry: &dyn LaunchRegistry,
    request: &InjectionRequest,
    node: &Node,
) -> Result<Injected, InjectionError> {
    let jar = materialise(source, data_dir, node)?;
    let args = args::build(node, &jar, &request.user)?;
    let expectations = Expectations {
        node_id: Some(node.id.clone()),
        online_account: request.facts.online_account,
        build_id: Some(node.sha256.clone()),
        pre_granted: request.pre_granted,
    };
    let env = registry.register_launch(request.instance_id, expectations);
    if env.is_empty() {
        return Err(InjectionError::BridgeNotRunning);
    }
    Ok(Injected { node_id: node.id.clone(), args, env, _jar: jar })
}

impl StartArgs {
    /// Setzt die Argumente in die Startbeschreibung: die der Einspeisung (leer ohne sie) an ihren Platz zwischen denen der
    /// Version und denen des Nutzers (INGAME 3.6), dazu die verbleibenden des Nutzers.
    pub fn apply<'a>(&'a self, spec: LaunchSpec<'a>) -> LaunchSpec<'a> {
        LaunchSpec {
            injected_jvm_args: &self.injected_jvm,
            extra_jvm_args: &self.user_jvm,
            injected_game_args: &self.injected_game,
            extra_game_args: &self.user_game,
            ..spec
        }
    }
}

impl Injection {
    /// Die Argumente des Starts. Ohne Einspeisung sind es unverändert die des Nutzers.
    pub fn start_args(&self, user_jvm: &[String], user_game: &[String]) -> StartArgs {
        match self {
            Self::Injected(injected) => injected.start_args(),
            Self::Skipped(_) | Self::Failed(_) => {
                StartArgs { user_jvm: user_jvm.to_vec(), user_game: user_game.to_vec(), ..StartArgs::default() }
            }
        }
    }

    /// Die Umgebungsvariablen für das Spiel; nur eine Einspeisung setzt welche (INGAME 5.2).
    pub fn env(&self) -> &[(String, String)] {
        match self {
            Self::Injected(injected) => &injected.env,
            Self::Skipped(_) | Self::Failed(_) => &[],
        }
    }

    pub fn node_id(&self) -> Option<&str> {
        match self {
            Self::Injected(injected) => Some(&injected.node_id),
            Self::Skipped(_) | Self::Failed(_) => None,
        }
    }

    /// Das Spiel läuft: der Prozess gehört zum angemeldeten Start. Ohne Einspeisung gibt es nichts zu binden.
    pub fn bind_pid(&self, registry: &dyn LaunchRegistry, instance_id: &str, pid: u32) {
        if matches!(self, Self::Injected(_)) {
            registry.bind_pid(instance_id, pid);
        }
    }
}

impl Injected {
    fn start_args(&self) -> StartArgs {
        StartArgs {
            injected_jvm: self.args.jvm.clone(),
            injected_game: self.args.game.clone(),
            user_jvm: self.args.user_jvm.clone(),
            user_game: self.args.user_game.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;
    use crate::models::{Account, AccountKind, ModLoader};
    use crate::services::launch::{build_args, test_support::plain_spec};
    use crate::services::mojang::VersionJson;
    use crate::services::rules::Env;
    use crate::services::Dirs;
    use crate::services::friends::ingame::breaker::{FailureKind, InjectionState};
    use crate::services::friends::ingame::index::Loader;
    use crate::services::friends::ingame::materialise::sha256_hex;
    use crate::services::friends::ingame::test_support::{jar_node, unverified, FakeSource, TempDir};

    const JAR: &[u8] = b"PK\x03\x04 fabric jar";
    const NO_MODS: &[String] = &[];
    static ACTIVE: InjectionState = InjectionState::Active;

    /// Eine Brücke, die aufzeichnet, was ihr gesagt wird.
    #[derive(Default)]
    struct FakeBridge {
        running: bool,
        registered: RefCell<Vec<(String, Expectations)>>,
        bound: RefCell<Vec<(String, u32)>>,
    }

    impl FakeBridge {
        fn running() -> Self {
            Self { running: true, ..Self::default() }
        }
    }

    impl LaunchRegistry for FakeBridge {
        fn register_launch(&self, instance_id: &str, expectations: Expectations) -> Vec<(String, String)> {
            if !self.running {
                return Vec::new();
            }
            self.registered.borrow_mut().push((instance_id.to_owned(), expectations));
            vec![("PUMPKIN_IPC_PORT".to_owned(), "4711".to_owned())]
        }

        fn bind_pid(&self, instance_id: &str, pid: u32) {
            self.bound.borrow_mut().push((instance_id.to_owned(), pid));
        }
    }

    fn facts<'a>() -> LaunchFacts<'a> {
        LaunchFacts {
            friends_enabled: true,
            bridge_running: true,
            online_account: true,
            minecraft: "1.21.1",
            loader: ModLoader::Fabric,
            loader_version: "0.16.14",
            java_major: Some(21),
            global_switch: true,
            instance_state: &ACTIVE,
            launcher_version: "2.1.0",
            mod_ids_in_instance: NO_MODS,
        }
    }

    struct Setup {
        data: TempDir,
        game_dir: TempDir,
        source: FakeSource,
        node: Node,
    }

    fn setup() -> Setup {
        let node = jar_node("1.21.1-fabric", Loader::Fabric, JAR);
        Setup { data: TempDir::new(), game_dir: TempDir::new(), source: FakeSource::with_jar(&node, JAR), node }
    }

    fn inject_with(setup: &Setup, bridge: &FakeBridge, facts: LaunchFacts, pre_granted: bool, user_jvm: &[String]) -> Injection {
        let user = UserArgs { jvm: user_jvm, game: &[], game_dir: setup.game_dir.path() };
        inject(&setup.source, setup.data.path(), bridge, &InjectionRequest { facts, instance_id: "i1", user, pre_granted })
    }

    #[test]
    fn a_fitting_launch_registers_the_node_the_full_hash_and_the_pre_grant() {
        let setup = setup();
        let bridge = FakeBridge::running();

        let injection = inject_with(&setup, &bridge, facts(), true, &[]);

        assert!(matches!(injection, Injection::Injected(_)));
        let registered = bridge.registered.borrow();
        let [(instance, expectations)] = registered.as_slice() else { panic!("{} Anmeldungen", registered.len()) };
        assert_eq!(instance, "i1");
        assert_eq!(
            *expectations,
            Expectations {
                node_id: Some("1.21.1-fabric".to_owned()),
                online_account: true,
                build_id: Some(sha256_hex(JAR)),
                pre_granted: true,
            }
        );
        assert_eq!(expectations.build_id.as_deref().map(str::len), Some(64), "der volle SHA-256, nicht nur ein Anfang");
    }

    #[test]
    fn a_launch_without_the_pre_grant_asks() {
        let setup = setup();
        let bridge = FakeBridge::running();

        inject_with(&setup, &bridge, facts(), false, &[]);

        assert!(!bridge.registered.borrow()[0].1.pre_granted);
    }

    #[test]
    fn a_fitting_launch_gets_the_loader_option_and_the_env_of_the_bridge() {
        let setup = setup();
        let injection = inject_with(&setup, &FakeBridge::running(), facts(), false, &["-Dfabric.addMods=other.jar".to_owned()]);

        let start = injection.start_args(&[], &[]);

        let jar = setup.data.path().join("runtime").join("friends-mod").join("2.1.0").join(&setup.node.file);
        let separator = crate::services::friends::ingame::PATH_LIST_SEPARATOR;
        assert_eq!(start.injected_jvm, [format!("-Dfabric.addMods=other.jar{separator}{}", jar.display())]);
        assert!(start.injected_game.is_empty());
        assert!(start.user_jvm.is_empty(), "die ersetzte Eigenschaft des Nutzers ist in der Einspeisung aufgegangen");
        assert_eq!(injection.env(), [("PUMPKIN_IPC_PORT".to_owned(), "4711".to_owned())]);
        assert_eq!(injection.node_id(), Some("1.21.1-fabric"));
    }

    #[test]
    fn the_pid_is_bound_once_the_child_exists_and_only_for_an_injected_launch() {
        let setup = setup();
        let bridge = FakeBridge::running();
        let injected = inject_with(&setup, &bridge, facts(), false, &[]);
        let skipped = inject_with(&setup, &bridge, LaunchFacts { online_account: false, ..facts() }, false, &[]);

        injected.bind_pid(&bridge, "i1", 4242);
        skipped.bind_pid(&bridge, "i2", 1);

        assert_eq!(*bridge.bound.borrow(), [("i1".to_owned(), 4242)]);
    }

    /// Jede Tatsache, die das Tor verneint, ergibt einen Start ohne Option, ohne Umgebung und ohne Anmeldung.
    #[test]
    fn every_reason_to_skip_leaves_the_launch_untouched() {
        let setup = setup();
        let tripped = InjectionState::Active.tripped(FailureKind::MixinApplyFailed, "2.1.0");
        let off = InjectionState::UserOff;
        let own_mod = vec!["pumpkin_friends".to_owned()];
        let cases: Vec<(&str, LaunchFacts)> = vec![
            ("friends off", LaunchFacts { friends_enabled: false, ..facts() }),
            ("vanilla", LaunchFacts { loader: ModLoader::Vanilla, loader_version: "", ..facts() }),
            ("offline account", LaunchFacts { online_account: false, ..facts() }),
            ("java too old", LaunchFacts { java_major: Some(17), ..facts() }),
            ("java unknown", LaunchFacts { java_major: None, ..facts() }),
            ("id collision", LaunchFacts { mod_ids_in_instance: &own_mod, ..facts() }),
            ("global switch off", LaunchFacts { global_switch: false, ..facts() }),
            ("instance switch off", LaunchFacts { instance_state: &off, ..facts() }),
            ("breaker tripped", LaunchFacts { instance_state: &tripped, ..facts() }),
            ("newer minecraft", LaunchFacts { minecraft: "26.9", ..facts() }),
        ];
        let user_jvm = vec!["-Xss2M".to_owned(), "-Dfabric.addMods=mine.jar".to_owned()];
        for (name, facts) in cases {
            let bridge = FakeBridge::running();

            let injection = inject_with(&setup, &bridge, facts, true, &user_jvm);

            assert!(matches!(injection, Injection::Skipped(_)), "{name}");
            let expected = StartArgs { user_jvm: user_jvm.clone(), ..StartArgs::default() };
            assert_eq!(injection.start_args(&user_jvm, &[]), expected, "{name}");
            assert!(injection.env().is_empty(), "{name}");
            assert!(bridge.registered.borrow().is_empty(), "{name}");
            injection.bind_pid(&bridge, "i1", 7);
            assert!(bridge.bound.borrow().is_empty(), "{name}");
        }
    }

    fn version() -> VersionJson {
        serde_json::from_value(serde_json::json!({
            "id": "1.21.1", "type": "release", "mainClass": "net.minecraft.client.main.Main",
            "assetIndex": {"id": "17", "sha1": "x", "url": "u"},
            "downloads": {"client": {"sha1": "x", "url": "u"}},
            "libraries": [],
            "arguments": {"jvm": ["-cp", "${classpath}"], "game": ["--username", "${auth_player_name}"]}
        }))
        .unwrap()
    }

    /// Die Argumentliste eines Starts, so zusammengesetzt wie in `prepare_launch`: `start` in der Startbeschreibung.
    fn argument_list(start: &StartArgs) -> Vec<String> {
        let (version, dirs) = (version(), Dirs::new("/data"));
        let account = Account { id: "b50ad385-829d-3141-a216-7e7d7539ba7f".into(), username: "Notch".into(), kind: AccountKind::Offline, active: true };
        let env = Env { os: "linux", arch: "x86_64", features: Vec::new() };
        build_args(&start.apply(plain_spec(&version, &dirs, &account)), &env).unwrap()
    }

    /// Die Argumentliste, wie sie vor der Einspeisung entstand: die Argumente des Nutzers unverändert in der Beschreibung.
    fn argument_list_without_friends(user_jvm: &[String], user_game: &[String]) -> Vec<String> {
        let (version, dirs) = (version(), Dirs::new("/data"));
        let account = Account { id: "b50ad385-829d-3141-a216-7e7d7539ba7f".into(), username: "Notch".into(), kind: AccountKind::Offline, active: true };
        let env = Env { os: "linux", arch: "x86_64", features: Vec::new() };
        let spec = LaunchSpec { extra_jvm_args: user_jvm, extra_game_args: user_game, ..plain_spec(&version, &dirs, &account) };
        build_args(&spec, &env).unwrap()
    }

    #[test]
    fn a_skipped_launch_has_the_argument_list_and_env_of_a_launch_without_friends() {
        let setup = setup();
        let tripped = InjectionState::Active.tripped(FailureKind::ModLoadingError, "2.1.0");
        let off = InjectionState::UserOff;
        let own_mod = vec!["pumpkin_friends".to_owned()];
        let cases: Vec<(&str, LaunchFacts)> = vec![
            ("vanilla", LaunchFacts { loader: ModLoader::Vanilla, ..facts() }),
            ("offline account", LaunchFacts { online_account: false, ..facts() }),
            ("java too old", LaunchFacts { java_major: Some(17), ..facts() }),
            ("id collision", LaunchFacts { mod_ids_in_instance: &own_mod, ..facts() }),
            ("global switch off", LaunchFacts { global_switch: false, ..facts() }),
            ("instance switch off", LaunchFacts { instance_state: &off, ..facts() }),
            ("breaker tripped", LaunchFacts { instance_state: &tripped, ..facts() }),
        ];
        let (user_jvm, user_game) = (vec!["-Xss2M".to_owned(), "-Dfabric.addMods=mine.jar".to_owned()], vec!["--demo".to_owned()]);
        let baseline = argument_list_without_friends(&user_jvm, &user_game);
        for (name, facts) in cases {
            let user = UserArgs { jvm: &user_jvm, game: &user_game, game_dir: setup.game_dir.path() };
            let request = InjectionRequest { facts, instance_id: "i1", user, pre_granted: false };
            let injection = inject(&setup.source, setup.data.path(), &FakeBridge::running(), &request);

            assert_eq!(argument_list(&injection.start_args(&user_jvm, &user_game)), baseline, "{name}");
            assert!(injection.env().is_empty(), "{name}");
        }
    }

    #[test]
    fn a_fitting_launch_has_the_injected_option_after_the_version_options_and_before_the_users() {
        let setup = setup();
        let (user_jvm, user_game) = (vec!["-Xss2M".to_owned()], vec!["--demo".to_owned()]);
        let user = UserArgs { jvm: &user_jvm, game: &user_game, game_dir: setup.game_dir.path() };
        let request = InjectionRequest { facts: facts(), instance_id: "i1", user, pre_granted: false };
        let injection = inject(&setup.source, setup.data.path(), &FakeBridge::running(), &request);

        let args = argument_list(&injection.start_args(&user_jvm, &user_game));

        let jar = setup.data.path().join("runtime").join("friends-mod").join("2.1.0").join(&setup.node.file);
        let expected_option = format!("-Dfabric.addMods={}", jar.display());
        let baseline = argument_list_without_friends(&user_jvm, &user_game);
        let at_user_option = baseline.iter().position(|arg| arg == "-Xss2M").unwrap();
        let mut expected = baseline.clone();
        expected.insert(at_user_option, expected_option);
        assert_eq!(args, expected);
        assert!(!injection.env().is_empty());
    }

    #[test]
    fn game_options_of_the_injection_sit_between_the_version_options_and_the_users() {
        let start = StartArgs {
            injected_game: vec!["--fml.mavenRoots".to_owned(), "root".to_owned()],
            user_game: vec!["--demo".to_owned()],
            ..StartArgs::default()
        };

        let args = argument_list(&start);

        assert_eq!(args[args.len() - 3..], ["--fml.mavenRoots", "root", "--demo"]);
        assert!(args.iter().position(|arg| arg == "Notch").unwrap() < args.len() - 3);
    }

    #[test]
    fn an_unverified_cell_leaves_the_launch_untouched() {
        let mut setup = setup();
        setup.node = unverified(setup.node.clone());
        setup.source = FakeSource::with_jar(&setup.node, JAR);
        let bridge = FakeBridge::running();

        let injection = inject_with(&setup, &bridge, facts(), false, &[]);

        assert!(matches!(injection, Injection::Skipped(SkipReason::Unfit(_))));
        assert!(bridge.registered.borrow().is_empty());
    }

    #[test]
    fn a_jar_that_cannot_be_provided_leaves_the_launch_untouched() {
        let node = jar_node("1.21.1-fabric", Loader::Fabric, JAR);
        let setup = Setup { source: FakeSource::indexed_without_jar(&node), node, ..setup() };
        let bridge = FakeBridge::running();

        let injection = inject_with(&setup, &bridge, facts(), false, &["-Xss2M".to_owned()]);

        assert!(matches!(injection, Injection::Failed(InjectionError::Materialise(_))));
        assert_eq!(injection.start_args(&["-Xss2M".to_owned()], &[]).user_jvm, ["-Xss2M"]);
        assert!(injection.env().is_empty());
        assert!(bridge.registered.borrow().is_empty());
    }

    #[test]
    fn a_bridge_that_is_not_running_leaves_the_launch_untouched() {
        let setup = setup();
        let bridge = FakeBridge::default();

        let injection = inject_with(&setup, &bridge, facts(), false, &["-Xss2M".to_owned()]);

        assert!(matches!(injection, Injection::Failed(InjectionError::BridgeNotRunning)));
        assert_eq!(injection.start_args(&["-Xss2M".to_owned()], &[]).user_jvm, ["-Xss2M"]);
        assert!(injection.env().is_empty());
    }
}
