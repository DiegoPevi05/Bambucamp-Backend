import * as reserveRepository from '../repositories/ReserveRepository';
import { PaginatedReserve, ReserveDto, ReserveFilters, ReserveOptions, createReserveExperienceDto, createReserveProductDto } from "../dto/reserve";
import * as promotionRepository from '../repositories/PromotionRepository';
import *  as userRepository from '../repositories/userRepository';
import * as productService from './productService';
import * as experienceService from './experienceService';
import * as utils from '../lib/utils';
import { BadRequestError, NotFoundError, UnauthorizedError } from "../middleware/errors";
import {sendReservationEmail} from '../config/email/mail';
import { PaymentStatus, Reserve, ReserveStatus, User} from '@prisma/client';
import { calculatePrice } from '../lib/utils';
import {PublicTent} from '../dto/tent';

interface Pagination {
  page: number;
  pageSize: number;
}

export const searchAvailableTents = async (dateFromInput:string,dateToInput:string) => {
  const dateFrom = new Date(dateFromInput);
  const dateTo = new Date(dateToInput);
  const tents = await reserveRepository.searchAvailableTents(dateFrom, dateTo);

  const TentsPublic:PublicTent[]  = [] 

  tents.forEach((tent) => {

    let tentPublic:PublicTent = { 
      ...tent, 
      images: JSON.parse(tent.images ? tent.images : '[]'),
      custom_price: calculatePrice(tent.price,tent.custom_price) 
    }
    TentsPublic.push(tentPublic);
  });

  return TentsPublic;
};

export const getAllMyReservesCalendarUser = async(page:number,userId:number) => {
  return reserveRepository.getMyReservesByMonth(page,userId);
}

export const getAllMyReservesCalendar = async(page:number,userId?:number) => {
  return reserveRepository.getMyReservesByMonth(page,userId);
}

export const getAllMyReservesUser = async (pagination: Pagination, userId: number) => {
  const MyReserves = await reserveRepository.getMyReserves(pagination, userId);
  
  if (MyReserves?.reserves) {
    utils.parseImagesInReserves(MyReserves.reserves);
  }

  return MyReserves;
};

export const getAllMyReserves = async (pagination: Pagination, userId?: number) => {
  const MyReserves = await reserveRepository.getMyReserves(pagination, userId);

  if (MyReserves?.reserves) {
    utils.parseImagesInReserves(MyReserves.reserves);
  }

  return MyReserves;
};

export const getAllReseveOptions = async():Promise<ReserveOptions> => {
  const reserveOptions = await reserveRepository.getAllReserveOptions();

  reserveOptions?.tents?.forEach((tent)=>{
    tent.images = JSON.parse(tent.images ? tent.images : '[]');

  })

  reserveOptions?.products?.forEach((product)=>{
    product.images = JSON.parse(product.images ? product.images : '[]');
  })

  reserveOptions?.experiences?.forEach((experience)=>{
    experience.images = JSON.parse(experience.images ? experience.images : '[]');
  })

  reserveOptions?.promotions?.forEach((promotion)=>{
    promotion.images = JSON.parse(promotion.images ? promotion.images : '[]');
  })

  return reserveOptions;

}



export const getAllReserves = async (filters:ReserveFilters, pagination:Pagination):Promise<PaginatedReserve> => {
  return await reserveRepository.getAllReserves(filters,pagination);
};

export const getReserveById = async (id: number) => {
  return await reserveRepository.getReserveById(id);
};

export const createReserveByUser = async (data: ReserveDto, user: User, language:string) => {
  data.userId = user.id;
  data.price_is_calculated = true;
  data.payment_status = PaymentStatus.UNPAID;
  data.reserve_status = ReserveStatus.NOT_CONFIRMED; 
  const reserve = await createReserve(data);
  if(reserve == null) throw new BadRequestError("error.failedToCreateReserve")
  await sendReservationEmail({ email:user.email, firstName:user.firstName}, reserve, language );
};


export const createReserve = async (data: ReserveDto):Promise<ReserveDto|null> => {

  data.tents = utils.normalizeTimesInTents(data.tents);
  data.dateSale = new Date();
  data.discount_code_id = Number(data.discount_code_id);
  data.userId = Number(data.userId);
  data.canceled_reason = "";

  const promotionsDB = await utils.getPromotions(data.promotions);

  if(promotionsDB.length > 0 ){
    if(!utils.validatePromotionRequirements(promotionsDB,data.promotions,data.tents,data.experiences,data.products)){
      throw new BadRequestError("error.noAllPromotionsFound");
    }
  }

  const tentsDb = await utils.getTents(data.tents);

  const productsDb = await utils.getProducts(data.products);

  const experiencesDb = await utils.getExperiences(data.experiences);
  
  // Check Availability
  const TentsAreAvialble = await utils.checkAvailability(data.tents);

  if(!TentsAreAvialble){
    throw new BadRequestError("error.noTentsAvailable");
  }

  if(data.price_is_calculated){
      // Map quantities to the respective tents, products, and experiences
      const tentsWithQuantities = tentsDb.map(tent => ({
        tent,
        nights: data.tents.find(t => t.idTent === tent.id)?.nights || 1,
        aditionalPeople: data.tents.find(t => t.idTent === tent.id)?.aditionalPeople || 1
      }));

      const productsWithQuantities = productsDb.map(product => ({
        product,
        quantity: data.products.find(p => p.idProduct === product.id)?.quantity || 1
      }));

      const experiencesWithQuantities = experiencesDb.map(experience => ({
        experience,
        quantity: data.experiences.find(e => e.idExperience === experience.id)?.quantity || 1
      }));

      // Calculate total price
      data.net_import = utils.calculateReservePrice(tentsWithQuantities, productsWithQuantities, experiencesWithQuantities);

      const { grossImport, discount, discount_name } = await utils.applyDiscount(data.net_import, data.discount_code_id);
      data.discount_code_name = discount_name != null ? discount_name : "";
      data.gross_import = grossImport;
      data.discount = discount;

  }else{
      const { grossImport, discount, discount_name } = await utils.applyDiscount(data.net_import, data.discount_code_id, data.discount);
      data.discount_code_name = discount_name != null ? discount_name : "";
      data.gross_import = grossImport;
      data.discount = discount;

  }

  await promotionRepository.reducePromotionStock(data.promotions);

  return await reserveRepository.createReserve(data);
};

export const updateReserve = async (id:number, data: ReserveDto) => {

  const reserve = await reserveRepository.getReserveById(id);

  if(!reserve){
    throw new NotFoundError('error.noReservefoundInDB');
  }

  const user = await userRepository.getUserById(data.userId);

  if(!user){
    throw new NotFoundError('error.noUserFoundInDB');
  }

  if(reserve.userId != user.id){
    reserve.userId = user.id;
  }

  data.tents = utils.normalizeTimesInTents(data.tents);
  data.discount_code_id = Number(data.discount_code_id);
  data.userId = Number(data.userId);

  reserve.dateSale = new Date(data.dateSale);

  const promotionsDB = await utils.getPromotions(data.promotions);

  if(!utils.validatePromotionRequirements(promotionsDB,data.promotions,data.tents,data.experiences,data.products)){
    throw new BadRequestError("error.noAllPromotionsFound");
  }

  const tentsDb = await utils.getTents(data.tents);

  const productsDb = await utils.getProducts(data.products);

  const experiencesDb = await utils.getExperiences(data.experiences);
  
  // Check Availability
  const TentsAreAvialble = await utils.checkAvailability(data.tents);

  if(!TentsAreAvialble){
    throw new BadRequestError("error.noTentsAvailable");
  }

  if(data.price_is_calculated){
      // Map quantities to the respective tents, products, and experiences
      const tentsWithQuantities = tentsDb.map(tent => ({
        tent,
        nights: data.tents.find(t => t.idTent === tent.id)?.nights || 1,
        aditionalPeople: data.tents.find(t => t.idTent === tent.id)?.aditionalPeople || 1
      }));

      const productsWithQuantities = productsDb.map(product => ({
        product,
        quantity: data.products.find(p => p.idProduct === product.id)?.quantity || 1
      }));

      const experiencesWithQuantities = experiencesDb.map(experience => ({
        experience,
        quantity: data.experiences.find(e => e.idExperience === experience.id)?.quantity || 1
      }));

      // Calculate total price
      reserve.net_import = utils.calculateReservePrice(tentsWithQuantities, productsWithQuantities, experiencesWithQuantities);

      const { grossImport, discount, discount_name } = await utils.applyDiscount(data.net_import, data.discount_code_id);
      reserve.discount_code_id = data.discount_code_id;
      reserve.discount_code_name = discount_name != null ? discount_name : "";
      reserve.gross_import = grossImport;
      reserve.discount = discount;

  }else{
      const { grossImport, discount, discount_name } = await utils.applyDiscount(data.net_import, data.discount_code_id, data.discount);
      reserve.discount_code_id = data.discount_code_id;
      reserve.net_import = data.net_import;
      reserve.discount_code_name = discount_name != null ? discount_name : "";
      reserve.gross_import = grossImport;
      reserve.discount = discount;

  }

  await promotionRepository.reducePromotionStock(data.promotions);

  await reserveRepository.upsertReserveDetails(reserve.id, data.tents, data.products, data.experiences, data.promotions);

  return await reserveRepository.updateReserve(id,reserve);
};

export const deleteReserve = async (id: number) => {
  return await reserveRepository.deleteReserve(id);
};

export const AddProductReserveByUser = async(userId: number, data: createReserveProductDto) => {

  const reserve = await reserveRepository.getReserveById(data.reserveId);

  if (!reserve) {
    throw new NotFoundError('error.noReservefoundInDB');
  }

  if (reserve.userId !== userId) {
    throw new UnauthorizedError('error.unauthorized');
  }

  const product = await productService.getProductById(data.idProduct);

  if(!product){
    throw new NotFoundError("error.noProductFoundInDB");
  }

  data.name      = product.name;
  data.price     = utils.calculatePrice(product.price,product.custom_price);
  data.confirmed = false;
  await AddProductReserve(reserve, data);  // Pass reserve object to avoid duplicate search
};

export const AddProductReserve = async(reserve: Reserve | null, data: createReserveProductDto) => {

  // If reserve is not provided, fetch it from the repository
  if (!reserve) {
    reserve = await reserveRepository.getReserveById(data.reserveId);

    if (!reserve) {
      throw new NotFoundError('error.noReservefoundInDB');
    }
  }

  const isStock = await productService.checkProductStock(data.idProduct, data.quantity);

  if (!isStock) {
    throw new NotFoundError('error.noProductsFoundInStock');
  }

  return await reserveRepository.AddProductReserve(data);
};

export const deleteProductReserve = async (id: number) => {
  return await reserveRepository.deleteProductReserve(id);
};

export const updateConfirmStatusProductReserve = async (id: number, confirmed:boolean) => {
  return await reserveRepository.updateProductReserve(id,confirmed);
};

export const AddExperienceReserveByUser = async(userId: number, data: createReserveExperienceDto[]) => {

  // Assume all data objects belong to the same reserve
  const reserveId = data[0].reserveId;
  const reserve = await reserveRepository.getReserveById(reserveId);

  if (!reserve) {
    throw new NotFoundError('error.noReservefoundInDB');
  }

  if (reserve.userId !== userId) {
    throw new UnauthorizedError('error.unauthorized');
  }

  const updatedExperiences = await Promise.all(data.map(async experienceData => {
    const experience = await experienceService.getExperienceById(experienceData.idExperience);

    if (!experience) {
      throw new NotFoundError("error.noExperienceFoundInDB");
    }

    experienceData.name = experience.name;
    experienceData.price = utils.calculatePrice(experience.price, experience.custom_price);
    experienceData.confirmed = false;
    return experienceData;
  }));

  // Pass the entire array to the AddExperienceReserve function
  await AddExperienceReserve(reserve, updatedExperiences);
};


export const AddExperienceReserve = async(reserve: Reserve | null, data: createReserveExperienceDto[]) => {
  // If reserve is not provided, fetch it from the repository (assuming all belong to the same reserve)
  if (!reserve) {
    const reserveId = data[0].reserveId;
    reserve = await reserveRepository.getReserveById(reserveId);

    if (!reserve) {
      throw new NotFoundError('error.noReservefoundInDB');
    }
  }

  const processedExperiences = data.map(experienceData => {
    if (experienceData.day) {
      const date_parsed = new Date(experienceData.day);
      date_parsed.setUTCHours(17, 0, 0, 0);  // This modifies the date in place
      experienceData.day = date_parsed;
    }
    return experienceData;
  });

  // Pass the entire array to the repository method
  return await reserveRepository.AddExperienceReserve(processedExperiences);
};

export const deleteExperienceReserve = async (id: number) => {
  return await reserveRepository.deleteExperienceReserve(id);
};

export const updateConfirmStatusExperienceReserve = async (id: number, confirmed:boolean) => {
  return await reserveRepository.updateExperienceReserve(id,confirmed);
};
