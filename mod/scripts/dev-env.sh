# Richtet die JDKs für einen Knoten ein: lädt vollständige Temurin-JDKs von der Adoptium-API nach mod/.jdk/<Version>
# (ohne Adminrechte) und setzt JAVA_HOME (das JDK für Gradle) sowie PUMPKIN_JDK_<Version> (die JDKs, die Gradle als
# Toolchain findet). Aus mod/ mit Punkt aufrufen, damit die Variablen in der Shell bleiben:
#   . scripts/dev-env.sh [Knoten-Id]        (Standard: der erste Knoten in nodes.txt)
# Wo ein Punkt-Aufruf keine Argumente erlaubt: PUMPKIN_NODE=<Knoten-Id> . scripts/dev-env.sh
# Welches JDK ein Knoten braucht, steht in nodes.txt (Spalte java); das JDK, auf dem Gradle selbst läuft, in Spalte
# gradleJdk (Stonecutter verlangt Java 21, Fabric Loom Java 25). Bereits gesetzte PUMPKIN_JDK_<Version>
# werden nicht neu geladen. Mojangs Laufzeiten sind nur JREs ohne javac; deshalb immer eigene JDKs (SPEC 11.1).
# Kein "set -e": beim Einlesen mit "." würde es die aufrufende Shell beenden. "local" gibt es in bash, dash und zsh.

pumpkin_jdk_os() {
	case "$(uname -s)" in
		Linux) echo linux ;;
		Darwin) echo mac ;;
		*) echo "Nur Linux und macOS; unter Windows scripts/dev-env.ps1 nutzen." >&2; return 1 ;;
	esac
}

pumpkin_jdk_arch() {
	case "$(uname -m)" in
		x86_64 | amd64) echo x64 ;;
		arm64 | aarch64) echo aarch64 ;;
		*) echo "Unbekannte Architektur: $(uname -m)" >&2; return 1 ;;
	esac
}

pumpkin_sha256() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | cut -d ' ' -f 1
	else
		shasum -a 256 "$1" | cut -d ' ' -f 1
	fi
}

# Das "package"-Objekt der Antwort enthält keine verschachtelten Objekte; so reicht sed statt jq.
pumpkin_package_field() {
	tr -d '\n' | grep -o '"package"[^}]*}' | sed -n "s/.*\"$1\" *: *\"\\([^\"]*\\)\".*/\\1/p"
}

pumpkin_install_jdk() {
	local feature_version=$1 jdk_dir=$2 os arch query assets link checksum staging archive actual
	os=$(pumpkin_jdk_os) || return 1
	arch=$(pumpkin_jdk_arch) || return 1
	query="architecture=$arch&image_type=jdk&os=$os&vendor=eclipse"
	assets=$(curl -fsSL "https://api.adoptium.net/v3/assets/latest/$feature_version/hotspot?$query") || return 1
	link=$(printf '%s' "$assets" | pumpkin_package_field link)
	checksum=$(printf '%s' "$assets" | pumpkin_package_field checksum)
	case "$checksum" in
		*[!0-9a-f]* | "") echo "Adoptium-API lieferte keine SHA-256-Prüfsumme." >&2; return 1 ;;
	esac
	[ ${#checksum} -eq 64 ] || { echo "Prüfsumme hat nicht 64 Zeichen." >&2; return 1; }
	staging=$(mktemp -d) || return 1
	archive="$staging/jdk.tar.gz"
	if ! curl -fsSL -o "$archive" "$link"; then
		rm -rf "$staging"
		return 1
	fi
	actual=$(pumpkin_sha256 "$archive")
	if [ "$actual" != "$checksum" ]; then
		echo "Prüfsumme stimmt nicht: erwartet $checksum, erhalten $actual." >&2
		rm -rf "$staging"
		return 1
	fi
	tar -xzf "$archive" -C "$staging" || { rm -rf "$staging"; return 1; }
	rm -rf "$jdk_dir"
	# Das Archiv enthält genau einen Ordner jdk-<Version>…; er wird zu mod/.jdk/<Version>.
	mv "$staging"/jdk-* "$jdk_dir" || { rm -rf "$staging"; return 1; }
	rm -rf "$staging"
	echo "Temurin $feature_version nach $jdk_dir installiert (SHA-256 geprüft)." >&2
}

pumpkin_java_home() {
	# macOS-Archive legen das JDK unter Contents/Home ab.
	if [ -d "$1/Contents/Home" ]; then echo "$1/Contents/Home"; else echo "$1"; fi
}

# nodes.txt: Spalte 1 Id, Spalte 5 java. Kommentare und Leerzeilen überspringt awk.
pumpkin_nodes() {
	awk '{ sub(/#.*/, "") } NF' nodes.txt
}

pumpkin_node_java() {
	pumpkin_nodes | awk -v id="$1" '$1 == id { print $5; found = 1 } END { exit !found }'
}

pumpkin_node_gradle_jdk() {
	pumpkin_nodes | awk -v id="$1" '$1 == id { print $7; found = 1 } END { exit !found }'
}

# Gibt JAVA_HOME des JDKs der Version $1 aus: ein gesetztes PUMPKIN_JDK_<Version> oder das geladene mod/.jdk/<Version>.
pumpkin_jdk_home() {
	local feature_version=$1 preset jdk_dir
	eval "preset=\${PUMPKIN_JDK_$feature_version:-}"
	if [ -n "$preset" ]; then
		echo "$preset"
		return 0
	fi
	jdk_dir="$PWD/.jdk/$feature_version"
	if [ ! -x "$(pumpkin_java_home "$jdk_dir")/bin/javac" ]; then
		pumpkin_install_jdk "$feature_version" "$jdk_dir" || return 1
	fi
	pumpkin_java_home "$jdk_dir"
}

# Beim Einlesen mit "." kennt POSIX-sh den Skriptpfad nicht; deshalb gilt das aktuelle Verzeichnis (mod/).
pumpkin_dev_env() {
	[ -f gradlew ] || { echo "Bitte aus dem Ordner mod/ aufrufen." >&2; return 1; }
	local node=${1:-${PUMPKIN_NODE:-$(pumpkin_nodes | awk 'NR == 1 { print $1 }')}} node_java gradle_java home feature_version
	node_java=$(pumpkin_node_java "$node") || { echo "Unbekannter Knoten: $node (siehe nodes.txt)" >&2; return 1; }
	gradle_java=$(pumpkin_node_gradle_jdk "$node")
	for feature_version in $node_java $gradle_java; do
		home=$(pumpkin_jdk_home "$feature_version") || return 1
		export "PUMPKIN_JDK_$feature_version=$home"
	done
	eval "JAVA_HOME=\$PUMPKIN_JDK_$gradle_java"
	PATH="$JAVA_HOME/bin:$PATH"
	export JAVA_HOME PATH
	echo "Knoten $node: JDK $node_java für das Spiel, JAVA_HOME=$JAVA_HOME (JDK $gradle_java für Gradle)"
}

pumpkin_dev_env "$@"
