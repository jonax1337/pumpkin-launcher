/**
 * Fensterbreiten (px), unter denen Leisten umbrechen und Spalten oder Beschriftungen entfallen. Die Werte sind die
 * `data-*`-Schalter in den Stylesheets von ui/ und müssen dort dieselben sein; Tailwind-Klassen (`max-[900px]:`) können
 * keine Konstanten lesen und tragen sie ausgeschrieben.
 */
export const WIDTH = { xs: 800, sm: 900, md: 1040, lg: 1096, xl: 1180 } as const;
