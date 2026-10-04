// Klassenmodell einer Minecraft-Version mit Mojang-Namen: Klassen finden, Hierarchie ablaufen, Mitglieder aufloesen.

const SYNTHETIC_PREFIXES = ["lambda$", "access$"];

function normalizeForSuffixMatch(name) {
  return name.replaceAll("/", ".").replaceAll("$", ".");
}

/** `net/Foo.bar:(I)V` -> { owner: "net/Foo", name: "bar", descriptor: "(I)V" }; javap laesst den Besitzer weg, wenn es die aktuelle Klasse ist. */
function splitMemberReference(reference, currentClass) {
  const descriptorStart = reference.indexOf(":");
  const nameStart = reference.lastIndexOf(".", descriptorStart);
  return {
    owner: nameStart < 0 ? currentClass : reference.slice(0, nameStart),
    name: reference.slice(nameStart + 1, descriptorStart),
    descriptor: reference.slice(descriptorStart + 1),
  };
}

/** Vergleicht einen Namen mit einem Muster, in dem `*` beliebig viele Zeichen steht. */
function nameMatches(pattern, name) {
  const literalParts = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\$]/g, "\\$&"));
  return new RegExp(`^${literalParts.join(".*")}$`).test(name);
}

function isRealMember(member) {
  return !SYNTHETIC_PREFIXES.some((prefix) => member.name.startsWith(prefix)) && member.name !== "<clinit>";
}

export class ApiModel {
  #mappings;
  #readModels;
  #models = new Map();
  #jarClassNames;
  #readBodies;

  /**
   * @param mappings    Mappings (Proguard oder Identitaet)
   * @param jarClassNames Menge der Klassen der Jar (Namen der Jar, intern)
   * @param readModels  (obfNames[]) -> Map(obfName -> javap-Modell)
   * @param readBodies  (obfName) -> Map("name(descriptor)" -> Anweisungen) aus `javap -c`
   */
  constructor(mappings, jarClassNames, readModels, readBodies) {
    this.#readBodies = readBodies;
    this.#mappings = mappings;
    this.#jarClassNames = jarClassNames;
    this.#readModels = readModels;
  }

  classNames() {
    return this.#mappings.mojangClassNames();
  }

  /** Findet genau eine Klasse zu `reference` (voll qualifiziert oder als Namensende wie `Screen`, `SystemToast.SystemToastId`). */
  resolveClass(reference) {
    const wanted = normalizeForSuffixMatch(reference);
    const candidates = this.#mappings.mojangClassNames().filter((name) => {
      const normalized = normalizeForSuffixMatch(name);
      return normalized === wanted || normalized.endsWith(`.${wanted}`);
    });
    const exact = candidates.filter((name) => normalizeForSuffixMatch(name) === wanted);
    const unique = exact.length === 1 ? exact : candidates;
    if (unique.length === 1) return unique[0];
    if (unique.length === 0) return null;
    throw new Error(`${reference} ist mehrdeutig: ${unique.join(", ")}`);
  }

  /** Laedt die Klassen und alle ihre Oberklassen und Interfaces (soweit in der Jar). */
  loadWithAncestors(mojangNames) {
    let frontier = mojangNames;
    while (frontier.length > 0) {
      const obfNames = frontier
        .map((name) => this.#mappings.obfClass(name) ?? name)
        .filter((name) => this.#jarClassNames.has(name) && !this.#models.has(name));
      const loaded = this.#readModels([...new Set(obfNames)]);
      for (const [name, model] of loaded) this.#models.set(name, model);
      frontier = [...loaded.values()].flatMap((model) => this.#ancestorsOf(model));
    }
  }

  #ancestorsOf(model) {
    return [model.superName, ...model.interfaces].filter(Boolean).map((name) => this.#mappings.mojangClass(name));
  }

  #modelOf(mojangName) {
    return this.#models.get(this.#mappings.obfClass(mojangName) ?? mojangName);
  }

  /** Klasse zuerst, dann Oberklassen, dann Interfaces; jede Klasse hoechstens einmal. */
  hierarchy(mojangName, seen = new Set()) {
    const model = this.#modelOf(mojangName);
    if (!model || seen.has(mojangName)) return [];
    seen.add(mojangName);
    const ancestors = this.#ancestorsOf(model).flatMap((name) => this.hierarchy(name, seen));
    return [mojangName, ...ancestors];
  }

  #mojangMembersOf(mojangName) {
    const model = this.#modelOf(mojangName);
    return model.members.filter(isRealMember).map((member) => {
      const descriptor = this.#mappings.mojangDescriptor(member.descriptor);
      const name = member.name === "<init>" ? member.name : this.#mappings.mojangMemberName(model.name, member.name, descriptor);
      const obf = { obfClass: model.name, obfName: member.name, obfDescriptor: member.descriptor };
      return { kind: member.kind, name, modifiers: member.modifiers, descriptor, declaredIn: mojangName, obf };
    });
  }

  /** Alle Deklarationen von `memberName` entlang der Hierarchie; die tiefste Deklaration je Deskriptor gewinnt. */
  findMembers(mojangName, memberName) {
    const classes = memberName === "<init>" ? [mojangName] : this.hierarchy(mojangName);
    const found = new Map();
    for (const className of classes) {
      for (const member of this.#mojangMembersOf(className)) {
        const key = `${member.kind}${member.descriptor}`;
        if (member.name === memberName && !found.has(key)) found.set(key, member);
      }
    }
    return [...found.values()];
  }

  /** Namen in der Jar fuer jede Deklaration (Klasse, Oberklassen, Interfaces) desselben Namens und Deskriptors. */
  obfDeclarations(mojangName, memberName, descriptor) {
    return this.hierarchy(mojangName)
      .flatMap((className) => this.#mojangMembersOf(className))
      .filter((member) => member.name === memberName && member.descriptor === descriptor)
      .map((member) => member.obf);
  }

  /**
   * Aufrufe und Feldzugriffe im Rumpf von `methodName` (Mojang-Name oder roher Name wie `lambda$x$0`, `*` als Platzhalter) in der Klasse,
   * mit Mojang-Namen. Liefert fuer jede gleichnamige Methode (Ueberladungen) einen Eintrag.
   * Mit `all` stehen auch Anweisungen ohne Verweis (zum Beispiel `aconst_null`) in der Liste.
   */
  methodBodies(mojangName, methodName, { all = false } = {}) {
    const model = this.#modelOf(mojangName);
    const bodies = this.#readBodies(model.name);
    return model.members
      .filter((member) => member.kind === "method")
      .map((member) => ({ member, descriptor: this.#mappings.mojangDescriptor(member.descriptor) }))
      .map(({ member, descriptor }) => ({
        name: member.name === "<init>" ? member.name : this.#mappings.mojangMemberName(model.name, member.name, descriptor),
        rawName: member.name,
        descriptor,
        instructions: bodies.get(`${member.name === "<init>" ? model.name.replaceAll("/", ".") : member.name}${member.descriptor}`) ?? [],
      }))
      .filter((body) => nameMatches(methodName, body.name) || nameMatches(methodName, body.rawName))
      .map((body) => ({
        ...body,
        instructions: body.instructions.filter((i) => all || i.kind !== null).map((i) => this.#translateInstruction(i, model.name)),
      }));
  }

  #translateInstruction({ opcode, kind, target }, currentClass) {
    if (kind === null) return opcode;
    if (kind === "String") return `${opcode} ${JSON.stringify(target)}`;
    if (kind === "class") return `${opcode} ${this.#translateClassName(target)}`;
    const { owner, name, descriptor } = splitMemberReference(target, currentClass);
    const mojangDescriptor = this.#mappings.mojangDescriptor(descriptor);
    const mojangName = owner.startsWith("[") ? name : this.#inheritedMojangName(owner, name, mojangDescriptor);
    return `${opcode} ${this.#translateClassName(owner)}.${mojangName}:${mojangDescriptor}`;
  }

  /** Sucht den Mojang-Namen in der Klasse und ihren Oberklassen (der Besitzer im Bytecode ist der statische Typ). */
  #inheritedMojangName(obfOwner, obfName, mojangDescriptor) {
    const owner = this.#mappings.mojangClass(obfOwner);
    this.loadWithAncestors([owner]);
    for (const className of this.hierarchy(owner)) {
      const found = this.#mappings.declaredMojangMemberName(this.#mappings.obfClass(className) ?? className, obfName, mojangDescriptor);
      if (found) return found;
    }
    return obfName;
  }

  #translateClassName(name) {
    return name.startsWith("[") ? this.#mappings.mojangDescriptor(name) : this.#mappings.mojangClass(name);
  }

  /** Alle in `mojangName` selbst deklarierten Mitglieder (ohne Vererbtes). */
  declaredMembers(mojangName) {
    return this.#modelOf(mojangName) ? this.#mojangMembersOf(mojangName) : [];
  }
}
