export const STAR_MILESTONES = [5,10,20,50] as const;
export type StarMilestone = typeof STAR_MILESTONES[number];
export interface StarInvite {count:StarMilestone;projectUrl:string}
