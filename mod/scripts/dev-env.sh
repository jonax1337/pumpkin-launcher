# Lädt ein vollständiges Temurin-25-JDK von der Adoptium-API nach mod/.jdk (ohne Adminrechte) und setzt
# JAVA_HOME und PATH. Aus mod/ mit Punkt aufrufen, damit die Variablen in der Shell bleiben: . scripts/dev-env.sh
# Mojangs Laufzeiten sind nur JREs ohne javac; deshalb immer ein eigenes JDK (SPEC 11.1).
# Kein "set -e": beim Einlesen mit "." würde es die aufrufende Shell beenden. "local" gibt es in bash, dash und zsh.

pumpkin_jdk_feature_version=25

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
	local jdk_dir=$1 os arch query assets link checksum staging archive actual
	os=$(pumpkin_jdk_os) || return 1
	arch=$(pumpkin_jdk_arch) || return 1
	query="architecture=$arch&image_type=jdk&os=$os&vendor=eclipse"
	assets=$(curl -fsSL "https://api.adoptium.net/v3/assets/latest/$pumpkin_jdk_feature_version/hotspot?$query") || return 1
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
	# Das Archiv enthält genau einen Ordner jdk-25…; er wird zu mod/.jdk.
	mv "$staging"/jdk-* "$jdk_dir" || { rm -rf "$staging"; return 1; }
	rm -rf "$staging"
	echo "Temurin $pumpkin_jdk_feature_version nach $jdk_dir installiert (SHA-256 geprüft)."
}

pumpkin_java_home() {
	# macOS-Archive legen das JDK unter Contents/Home ab.
	if [ -d "$1/Contents/Home" ]; then echo "$1/Contents/Home"; else echo "$1"; fi
}

# Beim Einlesen mit "." kennt POSIX-sh den Skriptpfad nicht; deshalb gilt das aktuelle Verzeichnis (mod/).
pumpkin_dev_env() {
	[ -f gradlew ] || { echo "Bitte aus dem Ordner mod/ aufrufen." >&2; return 1; }
	local jdk_dir="$PWD/.jdk"
	if [ ! -x "$(pumpkin_java_home "$jdk_dir")/bin/javac" ]; then
		pumpkin_install_jdk "$jdk_dir" || return 1
	fi
	JAVA_HOME=$(pumpkin_java_home "$jdk_dir")
	PATH="$JAVA_HOME/bin:$PATH"
	export JAVA_HOME PATH
	echo "JAVA_HOME=$JAVA_HOME"
}

pumpkin_dev_env
