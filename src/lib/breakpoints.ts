/**
 * Fensterbreiten (px), unter denen Spalten oder Beschriftungen entfallen (Werkzeugleisten brechen von selbst um). Die Werte sind die
 * `data-*`-Schalter in den Stylesheets von ui/ und müssen dort dieselben sein; Tailwind-Klassen (`max-[900px]:`) können
 * keine Konstanten lesen und tragen sie ausgeschrieben.
 */
export const WIDTH = { sm: 900, md: 1040, lg: 1096, xl: 1180 } as const;
