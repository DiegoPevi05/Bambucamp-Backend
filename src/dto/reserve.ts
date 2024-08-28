import {  Experience, PaymentStatus, Tent, Product, Promotion, ReserveStatus } from '@prisma/client';
import { TentDto } from './tent';
import { ProductPublicDto } from './product';
import { ExperiencePublicDto } from './experience';
import { PromotionDto } from './promotion';
import { DiscountCodeDto } from './discountcode'; 

export interface ReserveTentDto {
  id?:number;
  idTent:number;
  name:string;
  price:number;
  nights:number;
  dateFrom:Date;
  dateTo:Date;
  aditionalPeople:number;
  tentDB?:Tent;
}

export interface ReserveProductDto {
  id?:number;
  idProduct:number;
  name:string;
  price:number;
  quantity:number;
  productDB?:Product;
}

export interface ReserveExperienceDto {
  id?:number;
  idExperience:number;
  name:string;
  price:number;
  quantity:number;
  day:Date;
  experienceDB?:Experience;
}

export interface ReservePromotionDto {
  id?:number;
  idPromotion:number;
  name:string;
  price:number;
  quantity:number;
  promotionDB?:Promotion;
}

export interface ReserveOptions {
  tents?: TentDto[];
  products?: ProductPublicDto[];
  experiences?:ExperiencePublicDto[];
  promotions?:PromotionDto[];
  discounts?:DiscountCodeDto[];
}

export interface ReserveDto {
  userId: number;
  tents: ReserveTentDto[];
  products: ReserveProductDto[];
  experiences: ReserveExperienceDto[];
  promotions:ReservePromotionDto[];
  dateSale: Date;
  price_is_calculated: boolean;
  discount_code_id: number;
  discount_code_name:string;
  net_import: number;
  discount: number;
  gross_import: number;
  canceled_reason: string;
  canceled_status: boolean;
  payment_status: PaymentStatus;
  reserve_status:ReserveStatus;
}

export interface ReserveFilters {
  dateFrom?:Date;
  dateTo?:Date;
}

export interface PaginatedReserve {
  reserves:ReserveDto[];
  totalPages:number;
  currentPage:number;
}

